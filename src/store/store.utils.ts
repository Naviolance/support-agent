// Pure helpers for the store queries. No database access here, so they are
// easy to unit test.

// Phone numbers are stored as free text ("+237 6 99 00 00 00", "699000000",
// "237699000000"). Cameroon numbers have 9 digits after the +237 country
// code, so two numbers match when their last 9 digits match.
export const PHONE_MATCH_DIGITS = 9;

// Returns the last 9 digits, or null when the input has fewer than 9 digits
// (too short to identify anyone safely).
export function phoneMatchKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < PHONE_MATCH_DIGITS) return null;
  return digits.slice(-PHONE_MATCH_DIGITS);
}

// Order numbers look like ORD-20260924-K3F9QZ. Customers may type them in
// lower case or with spaces around them.
export function normalizeOrderNumber(orderNumber: string): string {
  return orderNumber.trim().toUpperCase();
}

// In SQL LIKE, % and _ are wildcards. Escape them (and the escape character
// itself) so a customer searching "BD-50_X" matches that text literally.
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
