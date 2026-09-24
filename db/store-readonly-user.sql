-- Creates agent_readonly: the only database user the support agent uses to
-- read the truck parts store database.
--
-- Run it once against the STORE database, as the store's owner user:
--
--   psql "postgresql://truckparts:<owner-password>@localhost:5433/truckparts" \
--     -v agent_password='<a long random password>' \
--     -f db/store-readonly-user.sql
--
-- The password is passed in with -v so it is never committed to git.
-- Running the script again is safe: it updates the password and re-applies
-- the same grants.

\set ON_ERROR_STOP on

-- 1. Create the login role, or update its password if it already exists.
--    (psql variables are not expanded inside DO blocks, so \gexec runs the
--    generated statement instead.)
SELECT format('CREATE ROLE agent_readonly LOGIN PASSWORD %L', :'agent_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_readonly')
\gexec

ALTER ROLE agent_readonly LOGIN PASSWORD :'agent_password';

-- 2. Start from zero. If a table was granted by mistake before, remove it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM agent_readonly;

-- 3. Allow connecting and seeing the schema, nothing else yet.
SELECT format('GRANT CONNECT ON DATABASE %I TO agent_readonly', current_database())
\gexec
GRANT USAGE ON SCHEMA public TO agent_readonly;

-- 4. The whole allow-list: SELECT on the three tables the agent's tools read.
--    users, sessions, password_reset_tokens, payments and everything else
--    stay invisible.
GRANT SELECT ON orders, order_items, products TO agent_readonly;

-- 5. Defense in depth, applied on every connection by this role:
--    - every transaction is read-only, even if a write grant slips in later.
--    - a runaway query is killed after 5 seconds instead of loading the
--      store database the customers depend on.
ALTER ROLE agent_readonly SET default_transaction_read_only = on;
ALTER ROLE agent_readonly SET statement_timeout = '5s';
