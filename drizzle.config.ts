import { defineConfig } from 'drizzle-kit'

// drizzle-kit не читает .env.local сам. Node 20.12+ умеет это встроенно,
// внешний dotenv не нужен. try/catch — на случай CI, где файла нет,
// а переменные приходят из окружения.
try {
  process.loadEnvFile('.env.local')
} catch {
  // .env.local отсутствует — работаем с тем, что уже в process.env
}

// Миграциям нужно ПРЯМОЕ соединение, без пулера: drizzle-kit берёт
// advisory-локи и гоняет многошаговый DDL, которому нужна стабильная сессия.
// PgBouncer в transaction-режиме её не гарантирует.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) throw new Error('Не задан ни DATABASE_URL_UNPOOLED, ни DATABASE_URL')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
