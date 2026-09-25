import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Tests that call the real AI model. Run on purpose only (npm run
// test:live): they use API quota and the model's answers vary.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.live-spec.ts'],
    testTimeout: 120_000,
  },
});
