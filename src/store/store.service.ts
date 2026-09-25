import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { STORE_POOL } from './store.constants.js';

// What the agent is allowed to know about an order. No address, no user id,
// no payment details: only what a customer needs to hear about their order.
export interface CustomerOrder {
  orderNumber: string;
  status: string;
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  total: number;
  shippingCity: string;
  createdAt: Date;
  updatedAt: Date;
  items: { productName: string; unitPrice: number; quantity: number }[];
}

export interface ProductMatch {
  name: string;
  slug: string;
  partNumber: string | null;
  crossReference: string[];
  condition: string;
  price: number;
  quantity: number;
}

// Cameroon numbers are 9 digits after the +237 country code. Comparing the
// last 9 digits makes "+237 6 70 12 34 56", "670123456" and "00237670123456"
// all match, since the store saves shippingPhone as typed.
const PHONE_DIGITS = 9;

export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= PHONE_DIGITS ? digits.slice(-PHONE_DIGITS) : null;
}

// Order numbers are generated as ORD-YYYYMMDD-XXXXXX, in upper case.
export function normalizeOrderNumber(orderNumber: string): string {
  return orderNumber.trim().toUpperCase();
}

// % and _ are wildcards in LIKE. A customer typing "10%" must not match
// everything, so they are escaped before the value goes into the pattern.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// pg returns NUMERIC columns as strings, to avoid losing precision. Prices
// are FCFA with 2 decimals, which a JS number holds exactly.
const toNumber = (value: string) => Number(value);

@Injectable()
export class StoreService {
  constructor(@Inject(STORE_POOL) private readonly pool: Pool) {}

  // The identity check: returns the order only when BOTH the order number and
  // the phone number match the same order. A wrong phone and an unknown order
  // both return null, so a caller cannot tell whether an order number exists.
  async findOrderForCustomer(
    orderNumber: string,
    phone: string,
  ): Promise<CustomerOrder | null> {
    const phoneDigits = normalizePhone(phone);
    if (!phoneDigits) return null;

    const { rows } = await this.pool.query<{
      id: string;
      orderNumber: string;
      status: string;
      subtotal: string;
      shippingTotal: string;
      discountTotal: string;
      total: string;
      shippingCity: string;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `SELECT id, "orderNumber", status, subtotal, "shippingTotal",
              "discountTotal", total, "shippingCity", "createdAt", "updatedAt"
         FROM orders
        WHERE "orderNumber" = $1
          AND right(regexp_replace("shippingPhone", '\\D', '', 'g'), ${PHONE_DIGITS}) = $2`,
      [normalizeOrderNumber(orderNumber), phoneDigits],
    );
    const order = rows[0];
    if (!order) return null;

    const items = await this.pool.query<{
      productName: string;
      unitPrice: string;
      quantity: number;
    }>(
      `SELECT "productName", "unitPrice", quantity
         FROM order_items
        WHERE "orderId" = $1
        ORDER BY "productName"`,
      [order.id],
    );

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: toNumber(order.subtotal),
      shippingTotal: toNumber(order.shippingTotal),
      discountTotal: toNumber(order.discountTotal),
      total: toNumber(order.total),
      shippingCity: order.shippingCity,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: items.rows.map((item) => ({
        productName: item.productName,
        unitPrice: toNumber(item.unitPrice),
        quantity: item.quantity,
      })),
    };
  }

  // Published products whose name, part number or cross reference contains
  // the query. Part numbers come first: a customer who types one wants that
  // exact part, not every product whose name happens to mention it.
  async searchProducts(query: string, limit = 5): Promise<ProductMatch[]> {
    const term = query.trim();
    if (!term) return [];
    const pattern = `%${escapeLike(term)}%`;

    const { rows } = await this.pool.query<{
      name: string;
      slug: string;
      partNumber: string | null;
      crossReference: string[];
      condition: string;
      price: string;
      quantity: number;
    }>(
      `SELECT name, slug, "partNumber", "crossReference", condition, price, quantity
         FROM products
        WHERE status = 'PUBLISHED'
          AND (name ILIKE $1
               OR "partNumber" ILIKE $1
               OR EXISTS (SELECT 1 FROM unnest("crossReference") AS ref
                           WHERE ref ILIKE $1))
        ORDER BY ("partNumber" ILIKE $2) DESC, "searchHits" DESC, name
        LIMIT $3`,
      [pattern, escapeLike(term), limit],
    );

    return rows.map((row) => ({ ...row, price: toNumber(row.price) }));
  }
}
