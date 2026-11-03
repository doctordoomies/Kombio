import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works at https://<user>.github.io/Kombio/
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
