<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PifPaf Pulse

Сервис аналитики рилсов для внутренних блогеров PifPaf AI. Тестовое задание.

**Читать перед работой:** [`PLAN.md`](PLAN.md) — спецификация (что строим и почему).
Планы исполнения по срезам — в `docs/superpowers/plans/`.

## Версии, которые уже сломали ожидания

Проверено по докам в `node_modules/next/dist/docs/`, не по памяти:

- **Next.js 16**, не 15. `middleware.ts` **устарел и переименован в `proxy.ts`**,
  экспорт функции — `proxy`, не `middleware`.
- **Proxy по умолчанию исполняется в Node.js-рантайме.** Опция `runtime` в proxy-файле
  недоступна и бросает ошибку при попытке её задать. Это НЕ Edge, как было до 15.2.
- `bcryptjs` 3.x везёт собственные типы — `@types/bcryptjs` не ставить, это пустая заглушка.
- `vitest.config.mts` — именно `.mts`. В package.json нет `"type": "module"`,
  и обычный `.ts` грузится как CommonJS, ломая `import.meta.url`.

## Стек

TypeScript · Next.js 16 (App Router) · PostgreSQL на Neon · Drizzle ORM ·
`jose` (JWT) · `bcryptjs` (пароли) · Tailwind · Recharts · Vitest · Apify API.

## Конвенции

- **ORM — Drizzle. Prisma не использовать.** Она прячет SQL, который в этом задании
  как раз и хотят увидеть.
- **Аналитические запросы — сырым SQL в `src/db/queries/`**, отдельными файлами
  с комментариями. Это витрина навыка, а не деталь реализации.
- **`jose`, не `jsonwebtoken`.** Node-рантайм в proxy это позволяет, но `jose` не
  зависит от Node API и сохраняет живым запасной деплой на Cloudflare Workers (`PLAN.md` §13).
- **Всё время в интерфейсе и в группировках — `Europe/Moscow`.** `TIMESTAMPTZ`
  хранится в UTC; `date_trunc` без `AT TIME ZONE` сдвинет данные на три часа.
- **Тексты интерфейса — по-русски, на «ты»**, в тоне pifpafai.com. Ошибки объяснять
  человеческим языком, без кодов и `Error: fetch failed`.
- **Нет данных — это `—`, а не `0`.** Instagram отдаёт `-1` для скрытых лайков и
  `null` для части метрик; ноль — валидное значение и путать их нельзя.
- Изоляция данных: в каждом эндпоинте `WHERE user_id = $session.userId`.
  Чужая запись отдаётся как **404**, не 403.

## Бюджет Apify — жёсткое ограничение

Free tier: $5/мес ÷ $2.70 за 1000 результатов ≈ **1850 синхронизаций в месяц**.
В ТЗ прямо написано «бесплатки хватит» — выход за лимит это провал условия задачи.

- Разработка идёт на фикстурах: `APIFY_MOCK=1`. Живые вызовы — только осознанно.
- Частота опроса адаптивная по возрасту рилса (`PLAN.md` §7), не фиксированная.
- Перед каждым запуском — проверка счётчика в таблице `apify_usage`.

## Команды

```bash
npm run dev          # дев-сервер
npm test             # vitest run
npm run test:watch   # vitest в watch-режиме
npm run build        # прод-сборка
npm run db:generate  # сгенерировать миграцию из schema.ts
npm run db:migrate   # применить миграции
npm run db:studio    # drizzle-kit studio
```
