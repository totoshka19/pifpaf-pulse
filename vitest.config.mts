import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // Тот же алиас, что в tsconfig.json: "@/*" -> "./src/*".
    // Через import.meta.url, а не __dirname — конфиг грузится как ESM.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
