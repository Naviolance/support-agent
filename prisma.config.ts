// Prisma CLI configuration (migrate, generate, studio). Prisma 7 does not
// load .env by itself, so dotenv does it here.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // process.env, not env(): env() throws when the variable is missing,
    // which would break `prisma generate` (no database needed) on a fresh
    // clone or CI. Commands that connect still fail if it is unset.
    url: process.env.AGENT_DATABASE_URL,
  },
});
