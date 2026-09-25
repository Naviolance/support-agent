import { validateEnv } from './env.validation.js';

const valid = {
  AGENT_DATABASE_URL: 'postgresql://agent@localhost:5434/support_agent',
  STORE_READONLY_URL: 'postgresql://agent_readonly@localhost:5433/truckparts',
  GEMINI_API_KEY: 'test-gemini-key',
};

describe('validateEnv', () => {
  it('accepts a complete environment', () => {
    expect(validateEnv(valid)).toBe(valid);
  });

  it('names every missing variable', () => {
    expect(() =>
      validateEnv({ ...valid, GEMINI_API_KEY: '', STORE_READONLY_URL: '' }),
    ).toThrow('STORE_READONLY_URL, GEMINI_API_KEY');
  });
});
