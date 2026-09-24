import { Injectable } from '@nestjs/common';
import { StoreDbService } from './store-db.service.js';
import {
  escapeLike,
  normalizeOrderNumber,
  phoneMatchKey,
  PHONE_MATCH_DIGITS,
} from './store.utils.js';

// What a customer may learn about their own order. The shipping address and
// phone number are never selected, so they can never reach the model.
export interface OrderSummary {
  orderNumber: string;
  status: string;
  placedAt: string;
  totalXaf: number;
  shippingCity: string;
  items: { name: string; quantity: number; unitPriceXaf: number }[];
}

export interface ProductSummary {
  name: string;
  partNumber: string | null;
  condition: string;
  priceXaf: number;
  inStock: boolean;
  quantityAvailable: number;
}

const MAX_SEARCH_RESULTS = 5;

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: Date;
  total: string; // pg returns NUMERIC as a string to avoid float rounding
  shippingCity: string;
}

interface OrderItemRow {
  productName: string;
  quantity: number;
  unitPrice: string;
}

interface ProductRow {
  name: string;
  partNumber: string | null;
  condition: string;
  price: string;
  quantity: number;
}

@Injectable()
export class StoreService {
  constructor(private readonly db: StoreDbService) {}

  // Returns the order only when BOTH the order number and the phone number
  // match. "Wrong phone" and "no such order" give the same null result, so
  // the answer never confirms that an order number exists.
  async getOrder(
    orderNumber: string,
    phone: string,
  ): Promise<OrderSummary | null> {
    const phoneKey = phoneMatchKey(phone);
    if (!phoneKey) return null;

    const [order] = await this.db.query<OrderRow>(
      `SELECT id, "orderNumber", status, "createdAt", total, "shippingCity"
         FROM orders
        WHERE "orderNumber" = $1
          AND right(regexp_replace("shippingPhone", '\\D', '', 'g'), $3) = $2`,
      [normalizeOrderNumber(orderNumber), phoneKey, PHONE_MATCH_DIGITS],
    );
    if (!order) return null;

    const items = await this.db.query<OrderItemRow>(
      `SELECT "productName", quantity, "unitPrice"
         FROM order_items
        WHERE "orderId" = $1
        ORDER BY "productName"`,
      [order.id],
    );

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      placedAt: order.createdAt.toISOString(),
      totalXaf: Number(order.total),
      shippingCity: order.shippingCity,
      items: items.map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        unitPriceXaf: Number(item.unitPrice),
      })),
    };
  }

  // Same fields as the store's own search (name, both descriptions, part
  // number), plus an exact match on cross-reference part numbers. Only
  // PUBLISHED products: drafts and archived products stay hidden.
  async searchProducts(query: string): Promise<ProductSummary[]> {
    const term = query.trim();
    if (term.length < 2) return [];

    const rows = await this.db.query<ProductRow>(
      `SELECT name, "partNumber", condition, price, quantity
         FROM products
        WHERE status = 'PUBLISHED'
          AND (name ILIKE $1
               OR description ILIKE $1
               OR "descriptionFr" ILIKE $1
               OR "partNumber" ILIKE $1
               OR upper($2) = ANY (SELECT upper(ref) FROM unnest("crossReference") AS ref))
        ORDER BY (quantity > 0) DESC, name
        LIMIT $3`,
      [`%${escapeLike(term)}%`, term, MAX_SEARCH_RESULTS],
    );

    return rows.map((row) => ({
      name: row.name,
      partNumber: row.partNumber,
      condition: row.condition,
      priceXaf: Number(row.price),
      inStock: row.quantity > 0,
      quantityAvailable: row.quantity,
    }));
  }
}
