import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Конфигурация для тестов, работающих с ЖИВОЙ базой Neon.
 *
 * Отдельно от основной, потому что:
 *  — им нужен `.env.local`, а обычным юнит-тестам он не нужен и не должен быть;
 *  — они ходят по сети, и держать их в `npm test` значит сделать быструю обратную
 *    связь медленной и зависящей от интернета.
 *
 * Запуск: `npm run test:db`
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/load-env.ts'],
    // Параллельные файлы делили бы одну базу и мешали друг другу.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
