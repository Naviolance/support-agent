import { StoreDbService } from './store-db.service.js';
import { StoreService } from './store.service.js';

function setup() {
  const db = { query: vi.fn() };
  const service = new StoreService(db as unknown as StoreDbService);
  return { db, service };
}

describe('StoreService.getOrder', () => {
  it('does not query the database when the phone is too short', async () => {
    const { db, service } = setup();
    await expect(service.getOrder('ORD-1', '12345')).resolves.toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('passes user input as parameters, never inside the SQL text', async () => {
    const { db, service } = setup();
    db.query.mockResolvedValueOnce([]);
    const evil = "ORD-1' OR '1'='1";
    await service.getOrder(evil, '+237 699 000 000');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain(evil.toUpperCase());
    expect(params).toEqual([evil.toUpperCase(), '699000000', 9]);
  });

  it('returns null when no order matches both values', async () => {
    const { db, service } = setup();
    db.query.mockResolvedValueOnce([]);
    await expect(service.getOrder('ORD-1', '699000000')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('maps rows to a safe summary with numeric prices', async () => {
    const { db, service } = setup();
    db.query
      .mockResolvedValueOnce([
        {
          id: 'o1',
          orderNumber: 'ORD-1',
          status: 'SHIPPED',
          createdAt: new Date('2026-09-20T10:00:00Z'),
          total: '33500.00',
          shippingCity: 'Douala',
        },
      ])
      .mockResolvedValueOnce([
        { productName: 'Oil filter', quantity: 1, unitPrice: '8500.00' },
      ]);

    const order = await service.getOrder('ORD-1', '699000000');
    expect(order).toEqual({
      orderNumber: 'ORD-1',
      status: 'SHIPPED',
      placedAt: '2026-09-20T10:00:00.000Z',
      totalXaf: 33500,
      shippingCity: 'Douala',
      items: [{ name: 'Oil filter', quantity: 1, unitPriceXaf: 8500 }],
    });
    expect(order).not.toHaveProperty('shippingAddress');
    expect(order).not.toHaveProperty('shippingPhone');
  });
});

describe('StoreService.searchProducts', () => {
  it('ignores searches shorter than 2 characters', async () => {
    const { db, service } = setup();
    await expect(service.searchProducts(' a ')).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('escapes wildcards and maps stock to inStock', async () => {
    const { db, service } = setup();
    db.query.mockResolvedValueOnce([
      {
        name: 'Oil filter',
        partNumber: '21707134',
        condition: 'NEW',
        price: '8500.00',
        quantity: 0,
      },
    ]);
    const results = await service.searchProducts('50_X');
    expect(db.query.mock.calls[0][1][0]).toBe('%50\\_X%');
    expect(results).toEqual([
      {
        name: 'Oil filter',
        partNumber: '21707134',
        condition: 'NEW',
        priceXaf: 8500,
        inStock: false,
        quantityAvailable: 0,
      },
    ]);
  });
});
