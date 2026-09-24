# Support Agent

An AI agent that handles customer messages for a truck spare parts store.
It reads the message, checks orders and products in the store database
(read-only), and either replies or escalates to a human.

Stack: TypeScript, NestJS, PostgreSQL, Claude API (tool use).

Status: in progress. Progress is tracked in commits.

## Store database access

The agent reads the store database through one Postgres user,
`agent_readonly`. It can SELECT from `orders`, `order_items` and
`products`, and nothing else. It cannot see `users`, `sessions`,
`password_reset_tokens` or `payments`. Every transaction it opens is
read-only, and every query stops after 5 seconds.

Create the user (run as the store's owner user, once):

```bash
psql "postgresql://truckparts:<owner-password>@localhost:5433/truckparts" \
  -v agent_password='<a long random password>' \
  -f db/store-readonly-user.sql
```

Prove the permissions:

```bash
STORE_READONLY_URL="postgresql://agent_readonly:<password>@localhost:5433/truckparts" \
  ./db/verify-store-readonly-user.sh
```

In production the agent would call the store's HTTP API instead of its
database, so the store keeps full control of its data. Direct read-only
access keeps this project small while the agent logic is the focus.
