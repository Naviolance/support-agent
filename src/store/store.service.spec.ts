import type { Pool } from 'pg';
import {
  escapeLike,
  normalizeOrderNumber,
  normalizePhone,
  StoreService,
} from './store.service.js';

// The SQL itself is checked against a real store database by
// test/store.e2e-spec.ts. These tests cover the logic around it: input
// normalization, the identity check and the row mapping.

function fakePool(...results: { rows: unknown[] }[]) {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  return { pool: { query } as unknown as Pool, query };
}

const orderRow = {
  id: 'order-uuid',
  orderNumber: 'ORD-20260924-AB12CD',
  status: 'SHIPPED',
  subtotal: '45000.00',
  shippingTotal: '2000.00',
  discountTotal: '0.00',
  total: '47000.00',
  shippingCity: 'Douala',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-22T10:00:00Z'),
};

describe('normalizePhone', () => {
  it.each([
    ['+237 6 70 12 34 56', '670123456'],
    ['670123456', '670123456'],
    ['00237670123456', '670123456'],
    ['(+237) 670-12-34-56', '670123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects numbers with fewer than 9 digits', () => {
    expect(normalizePhone('12345678')).toBeNull();
    expect(normalizePhone('no digits')).toBeNull();
  });
});

describe('normalizeOrderNumber', () => {
  it('trims and upper-cases', () => {
    expect(normalizeOrderNumber('  ord-20260924-ab12cd ')).toBe(
      'ORD-20260924-AB12CD',
    );
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('10%_off\\')).toBe('10\\%\\_off\\\\');
  });
});

describe('StoreService.findOrderForCustomer', () => {
  it('returns the order with its items when number and phone match', async () => {
    const { pool, query } = fakePool(
      { rows: [orderRow] },
      {
        rows: [
          { productName: 'Brake pad', unitPrice: '15000.00', quantity: 3 },
        ],
      },
    );
    const store = new StoreService(pool);

    const order = await store.findOrderForCustomer(
      'ord-20260924-ab12cd',
      '+237 670 12 34 56',
    );

    expect(query.mock.calls[0][1]).toEqual([
      'ORD-20260924-AB12CD',
      '670123456',
    ]);
    expect(query.mock.calls[1][1]).toEqual(['order-uuid']);
    expect(order).toEqual({
      orderNumber: 'ORD-20260924-AB12CD',
      status: 'SHIPPED',
      subtotal: 45000,
      shippingTotal: 2000,
      discountTotal: 0,
      total: 47000,
      shippingCity: 'Douala',
      createdAt: orderRow.createdAt,
      updatedAt: orderRow.updatedAt,
      items: [{ productName: 'Brake pad', unitPrice: 15000, quantity: 3 }],
    });
    // The internal id is used for the items query but never handed out.
    expect(order).not.toHaveProperty('id');
  });

  it('returns null when no order matches both values', async () => {
    const { pool, query } = fakePool({ rows: [] });
    const store = new StoreService(pool);

    await expect(
      store.findOrderForCustomer('ORD-20260924-AB12CD', '699999999'),
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not query at all when the phone is too short to check', async () => {
    const { pool, query } = fakePool();
    const store = new StoreService(pool);

    await expect(
      store.findOrderForCustomer('ORD-20260924-AB12CD', '1234'),
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('StoreService.searchProducts', () => {
  it('searches with an escaped pattern and converts prices', async () => {
    const { pool, query } = fakePool({
      rows: [
        {
          name: 'Brake pad set',
          slug: 'brake-pad-set',
          partNumber: 'BP-100',
          crossReference: ['XBP100'],
          condition: 'NEW',
          price: '15000.00',
          quantity: 4,
        },
      ],
    });
    const store = new StoreService(pool);

    const results = await store.searchProducts('  bp_100 ', 3);

    expect(query.mock.calls[0][1]).toEqual(['%bp\\_100%', 'bp\\_100', 3]);
    expect(results).toEqual([
      {
        name: 'Brake pad set',
        slug: 'brake-pad-set',
        partNumber: 'BP-100',
        crossReference: ['XBP100'],
        condition: 'NEW',
        price: 15000,
        quantity: 4,
      },
    ]);
  });

  it('returns nothing for an empty query without hitting the database', async () => {
    const { pool, query } = fakePool();
    const store = new StoreService(pool);

    await expect(store.searchProducts('   ')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
