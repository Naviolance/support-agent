import 'dotenv/config';
import { Pool } from 'pg';
import { StoreService } from '../src/store/store.service.js';

// Runs StoreService's SQL against the real store database from .env, as
// agent_readonly. That user cannot write, so the test uses the store's
// existing (seeded) data instead of inserting its own.
describe('StoreService against the store database (e2e)', () => {
  let pool: Pool;
  let store: StoreService;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.STORE_READONLY_URL });
    store = new StoreService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function anyOrder() {
    const { rows } = await pool.query<{
      orderNumber: string;
      shippingPhone: string;
    }>(
      `SELECT "orderNumber", "shippingPhone" FROM orders
        WHERE length(regexp_replace("shippingPhone", '\\D', '', 'g')) >= 9
        LIMIT 1`,
    );
    if (!rows[0])
      throw new Error(
        'The store database has no orders to test with. Seed it first.',
      );
    return rows[0];
  }

  it('finds an order when number and phone match, whatever the phone format', async () => {
    const { orderNumber, shippingPhone } = await anyOrder();
    const last9 = shippingPhone.replace(/\D/g, '').slice(-9);

    const order = await store.findOrderForCustomer(
      orderNumber.toLowerCase(),
      `+237 ${last9.slice(0, 3)} ${last9.slice(3)}`,
    );

    expect(order?.orderNumber).toBe(orderNumber);
    expect(order?.items.length).toBeGreaterThan(0);
    expect(typeof order?.total).toBe('number');
  });

  it('refuses the order when the phone belongs to someone else', async () => {
    const { orderNumber, shippingPhone } = await anyOrder();
    const last9 = shippingPhone.replace(/\D/g, '').slice(-9);
    const wrong = last9.slice(0, 8) + ((Number(last9[8]) + 1) % 10);

    await expect(
      store.findOrderForCustomer(orderNumber, wrong),
    ).resolves.toBeNull();
  });

  it('only returns published products', async () => {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM products WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    if (!rows[0])
      throw new Error(
        'The store database has no published products. Seed it first.',
      );
    const word = rows[0].name.split(' ')[0];

    const results = await store.searchProducts(word);

    expect(results.length).toBeGreaterThan(0);
    const { rows: statuses } = await pool.query<{ status: string }>(
      `SELECT DISTINCT status FROM products WHERE slug = ANY($1)`,
      [results.map((r) => r.slug)],
    );
    expect(statuses).toEqual([{ status: 'PUBLISHED' }]);
  });

  it('treats % in a search as text, not a wildcard', async () => {
    await expect(store.searchProducts('%')).resolves.toEqual([]);
  });
});
