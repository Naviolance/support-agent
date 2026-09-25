// Checked once at startup by ConfigModule. A missing variable stops the app
// immediately with a clear message, instead of failing on the first request.
const REQUIRED = [
  'AGENT_DATABASE_URL',
  'STORE_READONLY_URL',
  'GEMINI_API_KEY',
] as const;

export function validateEnv(env: Record<string, unknown>) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env.`,
    );
  }

  return env;
}
