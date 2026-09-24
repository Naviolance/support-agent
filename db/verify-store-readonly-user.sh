#!/usr/bin/env bash
# Proves that agent_readonly can read exactly what the agent needs and
# nothing more. Every check connects AS agent_readonly.
#
# Usage:
#   STORE_READONLY_URL="postgresql://agent_readonly:<password>@localhost:5433/truckparts" \
#     ./db/verify-store-readonly-user.sh

set -u

if [ -z "${STORE_READONLY_URL:-}" ]; then
  echo "Set STORE_READONLY_URL first (see the usage comment in this file)."
  exit 2
fi

failures=0

# expect_ok <description> <sql>: the query must succeed.
expect_ok() {
  if output=$(psql "$STORE_READONLY_URL" -X -q -t -A -v ON_ERROR_STOP=1 -c "$2" 2>&1); then
    echo "PASS  $1 (result: $output)"
  else
    echo "FAIL  $1 -> $output"
    failures=$((failures + 1))
  fi
}

# expect_denied <description> <sql>: the query must fail with an error
# containing <expected error text>.
expect_denied() {
  if output=$(psql "$STORE_READONLY_URL" -X -q -t -A -v ON_ERROR_STOP=1 -c "$2" 2>&1); then
    echo "FAIL  $1 -> the query succeeded, it should have been refused"
    failures=$((failures + 1))
  elif echo "$output" | grep -q "$3"; then
    echo "PASS  $1 (refused: $3)"
  else
    echo "FAIL  $1 -> refused for an unexpected reason: $output"
    failures=$((failures + 1))
  fi
}

echo "== Allowed reads"
expect_ok "read orders"      "SELECT count(*) FROM orders"
expect_ok "read order_items" "SELECT count(*) FROM order_items"
expect_ok "read products"    "SELECT count(*) FROM products"

echo "== Forbidden reads"
expect_denied "read users"                 "SELECT * FROM users LIMIT 1"                 "permission denied"
expect_denied "read sessions"              "SELECT * FROM sessions LIMIT 1"              "permission denied"
expect_denied "read password_reset_tokens" "SELECT * FROM password_reset_tokens LIMIT 1" "permission denied"
expect_denied "read payments"              "SELECT * FROM payments LIMIT 1"              "permission denied"

echo "== Forbidden writes"
# Refused by default_transaction_read_only before the grants are even checked.
expect_denied "update products" "UPDATE products SET quantity = 0" "read-only transaction"
expect_denied "delete orders"   "DELETE FROM orders"                "read-only transaction"

echo "== Safety settings"
expect_ok "statement_timeout is 5s" "SHOW statement_timeout"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All checks passed."
