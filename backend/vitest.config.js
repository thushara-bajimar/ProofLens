import { defineConfig } from 'vitest/config';

// Tests run against an isolated in-memory database and a throwaway storage
// folder, with their own auto-generated signing key — never the dev data.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      STORAGE_DIR: 'backend/tests/.tmp/storage',
      SIGNING_KEY_PATH: 'backend/tests/.tmp/keys/test-ed25519.pem',
      MODEL_PATH: 'storage/models',
      C2PA_CERT_DIR: 'backend/tests/.tmp/c2pa',
      RATE_LIMIT_MAX: '100000',
    },
  },
});
