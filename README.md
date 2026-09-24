# Support Agent

An AI agent that handles customer messages for a truck spare parts store.
It reads the message, checks orders and products in the store database
(read-only), and either replies or escalates to a human.

Stack: TypeScript, NestJS, PostgreSQL, Claude API (tool use).

Status: in progress. Progress is tracked in commits.

## Run it locally

Requires Node 22+ and Docker.

```bash
cp .env.example .env
npm install            # also generates the Prisma client
npm run db:up          # starts the agent's Postgres on port 5434
npm run db:migrate     # creates the tables
npm run start:dev
curl localhost:3000/health   # {"status":"ok","database":"ok"}
```

## Agent database

The agent stores its own data in a separate Postgres (Prisma 7):

- `conversations`: one per chat, with status `OPEN`, `RESOLVED` or
  `ESCALATED`, and the escalation reason.
- `messages`: every turn, stored as Claude API content blocks so the
  history can be replayed exactly. `seq` keeps strict order, because
  Postgres `now()` gives every row in one transaction the same timestamp.
- `tool_calls`: one row per tool execution with input, output, error flag
  and duration.

Metrics (resolved vs escalated, tool error rate, latency, token usage) are
queries over these tables.

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

## Decisions

- **No agent framework.** The tool-use loop is written by hand, so every
  step (model call, tool call, result, next call) is visible and testable.
- **Customers prove who they are with order number + phone number.** The
  agent only shares an order's details when both match the same order.
  An order number alone is guessable, and the phone number is already on
  every order, so the agent never needs to read the users table.
- **NestJS 12** (ES modules, Vitest, oxlint), the current release, rather
  than matching the store's NestJS 10.
