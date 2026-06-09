import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Match the tsconfig "@/*" → "src/*" path mapping so tests can
      // import via the same paths the app does.
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // By default vitest picks up *.test.ts / *.spec.ts anywhere.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Focus coverage on the pure modules we have tests for.
      include: [
        'scripts/seed-transforms.ts',
        'src/app/api/ingest/auth.ts',
        'src/app/api/ingest/schema.ts',
        'src/app/api/ingest/mappers.ts',
        'extension/src/voyager-parser.ts',
        'extension/src/voyager-profile-parser.ts',
      ],
    },
  },
});
