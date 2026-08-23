# PifPaf Pulse — срез 1: фундамент

> **Для исполнителя:** используй `superpowers:subagent-driven-development` (рекомендуется)
> или `superpowers:executing-plans`, чтобы выполнять план задача за задачей.
> Шаги размечены чекбоксами (`- [ ]`) для отслеживания прогресса.

**Цель:** каркас проекта, покрытые тестами функции нормализации данных, схема БД
и рабочая аутентификация с изоляцией данных между пользователями.

**Архитектура:** Next.js 15 App Router, единый деплой фронта и бэка. Чистые функции
нормализации (URL, метрики Apify) вынесены в `src/lib/` и покрыты юнит-тестами до
того, как появится первый запрос к внешнему API. Аутентификация — JWT в httpOnly
cookie: подпись и проверка через `jose` (работает в Edge-middleware), хеш пароля
через `bcryptjs` (только в Node-роутах).

**Стек:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL (Neon), `jose`, `bcryptjs`,
Tailwind, Vitest.

**Спека:** [`PLAN.md`](../../../PLAN.md) — читать вместе с этим планом.

## Глобальные ограничения

- Бюджет — **0 ₽**. Только бесплатные тарифы. Никаких платных сервисов и доменов.
- **Никаких живых вызовов Apify в этом срезе.** Работаем на фикстурах — кредиты
  расходуются только начиная со среза 3.
- ORM — **Drizzle**, не Prisma. Аналитические запросы — сырым SQL в `src/db/queries/`.
- JWT — **только `jose`**. `jsonwebtoken` в Edge-runtime не работает.
- `bcryptjs` **не импортируется** в `middleware.ts`.
- Тексты интерфейса и сообщения об ошибках — **на русском, на «ты»**.
- Время в интерфейсе и в группировках — **`Europe/Moscow`**, никогда не UTC.
- `APIFY_TOKEN` — только серверная переменная, никогда не `NEXT_PUBLIC_*`.

## Предусловия (делает человек, не агент)

- [ ] Прогнать `apify/instagram-scraper` в консоли Apify на 3–5 реальных ссылках,
      скачать JSON, положить в `fixtures/apify/` — понадобится в задаче 3.
- [ ] Создать проект в Neon, получить `DATABASE_URL`.
- [ ] Задеплоить пустой Next.js на Vercel и **открыть с телефона на мобильном
      интернете без VPN**. Это блокирующая проверка: если не открывается, площадку
      меняем сейчас, а не на двадцатом экране.

---

### Задача 1: Каркас проекта и тестовый харнесс

**Файлы:**
- Создать: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Создать: `src/app/layout.tsx`, `src/app/page.tsx`
- Создать: `.gitignore`, `.env.example`
- Тест: `src/lib/__tests__/smoke.test.ts`

**Интерфейсы:**
- Отдаёт наружу: рабочие команды `npm run dev`, `npm run build`, `npm test`.

- [ ] **Шаг 1: Создать проект**

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --no-import-alias
```

- [ ] **Шаг 2: Поставить зависимости среза**

```bash
npm i drizzle-orm postgres jose bcryptjs
npm i -D drizzle-kit vitest @types/bcryptjs
```

- [ ] **Шаг 3: Настроить Vitest**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

Добавить в `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Шаг 4: Написать smoke-тест**

`src/lib/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('харнесс', () => {
  it('запускается', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Шаг 5: Убедиться, что тесты идут**

Запустить: `npm test`
Ожидаем: `1 passed`.

- [ ] **Шаг 6: Заполнить `.env.example`**

```
DATABASE_URL=
APIFY_TOKEN=
APIFY_ACTOR_ID=apify~instagram-scraper
APIFY_MONTHLY_CAP=1500
APIFY_MOCK=1
JWT_SECRET=
CRON_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Проверить, что `.env*.local` и `.env` есть в `.gitignore`.

- [ ] **Шаг 7: Коммит**

```bash
git add -A && git commit -m "chore: scaffold next.js project with vitest"
```

---

### Задача 2: Нормализация ссылки на рилс

Первое, что сделает проверяющий, — вставит ссылку, скопированную с телефона.
Разбор URL — чистая функция без зависимостей, поэтому она идёт до всего остального.

**Файлы:**
- Создать: `src/lib/instagram/normalize-url.ts`
- Тест: `src/lib/instagram/normalize-url.test.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  type NormalizeResult =
    | { ok: true;  shortcode: string; canonicalUrl: string }
    | { ok: false; reason: string }

  function normalizeReelUrl(input: string): NormalizeResult
  ```
  `reason` — готовый к показу русский текст, не код ошибки.
  Используется в задаче среза 3 (`POST /api/reels`).

- [ ] **Шаг 1: Написать падающие тесты**

`src/lib/instagram/normalize-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeReelUrl } from './normalize-url'

const CODE = 'C8xYzAbCdEf'

describe('normalizeReelUrl — принимает реальные формы ссылок', () => {
  const accepted: [string, string][] = [
    ['каноническая',        `https://www.instagram.com/reel/${CODE}/`],
    ['множественное число', `https://www.instagram.com/reels/${CODE}/`],
    ['пост',                `https://instagram.com/p/${CODE}/`],
    ['igtv',                `https://www.instagram.com/tv/${CODE}/`],
    ['с автором в пути',    `https://www.instagram.com/pifpaf.ai/reel/${CODE}/`],
    ['хвост от «поделиться»', `https://www.instagram.com/reel/${CODE}/?igsh=MzRlODBiNWFlZA%3D%3D&img_index=1`],
    ['без протокола',       `instagram.com/reel/${CODE}`],
    ['мобильный поддомен',  `https://m.instagram.com/reel/${CODE}/`],
    ['с мусором по краям',  `  https://www.instagram.com/reel/${CODE}/\n`],
  ]

  it.each(accepted)('%s', (_name, input) => {
    const result = normalizeReelUrl(input)
    expect(result).toEqual({
      ok: true,
      shortcode: CODE,
      canonicalUrl: `https://www.instagram.com/reel/${CODE}/`,
    })
  })
})

describe('normalizeReelUrl — отклоняет мусор с человеческим объяснением', () => {
  const rejected: [string, string][] = [
    ['пустая строка',       ''],
    ['только пробелы',      '   '],
    ['не ссылка',           'просто текст'],
    ['чужой домен',         'https://www.tiktok.com/@user/video/123'],
    ['инстаграм, но профиль', 'https://www.instagram.com/pifpaf.ai/'],
    ['служебный раздел',    'https://www.instagram.com/explore/tags/reels/'],
    ['нет shortcode',       'https://www.instagram.com/reel/'],
    ['слишком короткий код', 'https://www.instagram.com/reel/ab/'],
  ]

  it.each(rejected)('%s', (_name, input) => {
    const result = normalizeReelUrl(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0)
      expect(result.reason).not.toMatch(/error|undefined|null/i)
    }
  })
})
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- normalize-url`
Ожидаем: FAIL, `Failed to resolve import './normalize-url'`.

- [ ] **Шаг 3: Реализовать**

`src/lib/instagram/normalize-url.ts`:

```ts
export type NormalizeResult =
  | { ok: true; shortcode: string; canonicalUrl: string }
  | { ok: false; reason: string }

/** Сегменты пути, после которых идёт shortcode медиа. */
const MEDIA_SEGMENTS = new Set(['reel', 'reels', 'p', 'tv'])

/** Instagram выдаёт shortcode в base64url-алфавите. */
const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,20}$/

export function normalizeReelUrl(input: string): NormalizeResult {
  const raw = (input ?? '').trim()
  if (!raw) {
    return { ok: false, reason: 'Вставь ссылку на рилс' }
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { ok: false, reason: 'Это не похоже на ссылку' }
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  if (host !== 'instagram.com' && host !== 'instagr.am') {
    return { ok: false, reason: 'Нужна ссылка с instagram.com' }
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const mediaIndex = segments.findIndex((s) => MEDIA_SEGMENTS.has(s.toLowerCase()))
  if (mediaIndex === -1) {
    return { ok: false, reason: 'Это ссылка на Instagram, но не на рилс или пост' }
  }

  const shortcode = segments[mediaIndex + 1]
  if (!shortcode) {
    return { ok: false, reason: 'В ссылке нет кода рилса — скопируй её целиком' }
  }
  if (!SHORTCODE_RE.test(shortcode)) {
    return { ok: false, reason: 'Код рилса в ссылке выглядит странно — проверь её' }
  }

  return {
    ok: true,
    shortcode,
    canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
  }
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- normalize-url`
Ожидаем: `17 passed`.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/instagram && git commit -m "feat: normalize instagram reel urls with tests"
```

---

### Задача 3: Нормализация ответа Apify

**Файлы:**
- Создать: `src/lib/instagram/normalize-item.ts`
- Тест: `src/lib/instagram/normalize-item.test.ts`
- Читает: `fixtures/apify/*.json` (из предусловий)

**Интерфейсы:**
- Потребляет: сырой элемент датасета `apify/instagram-scraper`.
- Отдаёт наружу:
  ```ts
  type ReelData = {
    shortcode: string
    caption: string | null
    ownerUsername: string | null
    postedAt: Date | null
    durationSec: number | null
    thumbnailSrc: string | null
    isReel: boolean
    views: number | null
    plays: number | null
    likes: number | null
    comments: number | null
  }

  function normalizeApifyItem(item: unknown): ReelData | null
  ```
  Используется в срезе 3 (запись снапшота) и срезе 4 (скачивание обложки).

- [ ] **Шаг 1: Написать падающие тесты**

`src/lib/instagram/normalize-item.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeApifyItem } from './normalize-item'

const base = {
  shortCode: 'C8xYzAbCdEf',
  caption: 'Тест',
  ownerUsername: 'pifpaf.ai',
  timestamp: '2026-08-01T12:00:00.000Z',
  videoDuration: 31.5,
  displayUrl: 'https://scontent.cdninstagram.com/x.jpg',
  productType: 'clips',
  likesCount: 100,
  commentsCount: 5,
  videoPlayCount: 5000,
  videoViewCount: 4200,
}

describe('normalizeApifyItem — приоритет метрик просмотров', () => {
  it('берёт videoPlayCount, когда есть оба поля', () => {
    expect(normalizeApifyItem(base)?.views).toBe(5000)
  })

  it('падает на videoViewCount, когда playCount равен null', () => {
    expect(normalizeApifyItem({ ...base, videoPlayCount: null })?.views).toBe(4200)
  })

  it('отдаёт null, когда обе метрики отсутствуют', () => {
    const result = normalizeApifyItem({ ...base, videoPlayCount: null, videoViewCount: null })
    expect(result?.views).toBeNull()
  })
})

describe('normalizeApifyItem — скрытые и битые счётчики', () => {
  it('превращает -1 (лайки скрыты автором) в null, а не в минус один', () => {
    expect(normalizeApifyItem({ ...base, likesCount: -1 })?.likes).toBeNull()
  })

  it('не путает ноль со скрытым значением', () => {
    expect(normalizeApifyItem({ ...base, commentsCount: 0 })?.comments).toBe(0)
  })
})

describe('normalizeApifyItem — разбор полей', () => {
  it('разбирает дату публикации', () => {
    expect(normalizeApifyItem(base)?.postedAt?.toISOString()).toBe('2026-08-01T12:00:00.000Z')
  })

  it('помечает не-рилс', () => {
    expect(normalizeApifyItem({ ...base, productType: 'feed' })?.isReel).toBe(false)
  })

  it('возвращает null, если нет shortCode', () => {
    expect(normalizeApifyItem({ ...base, shortCode: undefined })).toBeNull()
  })

  it('переживает пустой объект', () => {
    expect(normalizeApifyItem({})).toBeNull()
  })
})
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- normalize-item`
Ожидаем: FAIL, модуль не найден.

- [ ] **Шаг 3: Реализовать**

`src/lib/instagram/normalize-item.ts`:

```ts
export type ReelData = {
  shortcode: string
  caption: string | null
  ownerUsername: string | null
  postedAt: Date | null
  durationSec: number | null
  thumbnailSrc: string | null
  isReel: boolean
  views: number | null
  plays: number | null
  likes: number | null
  comments: number | null
}

/**
 * Instagram отдаёт -1, когда автор скрыл счётчик лайков.
 * Ноль при этом — валидное значение, путать их нельзя.
 */
function toCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeApifyItem(item: unknown): ReelData | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>

  const shortcode = toText(raw.shortCode)
  if (!shortcode) return null

  const plays = toCount(raw.videoPlayCount)
  const views = toCount(raw.videoViewCount)

  return {
    shortcode,
    caption: toText(raw.caption),
    ownerUsername: toText(raw.ownerUsername),
    postedAt: toDate(raw.timestamp),
    durationSec: typeof raw.videoDuration === 'number' ? raw.videoDuration : null,
    thumbnailSrc: toText(raw.displayUrl),
    isReel: raw.productType === 'clips',
    // videoPlayCount и videoViewCount — разные метрики, одна часто отсутствует
    views: plays ?? views,
    plays,
    likes: toCount(raw.likesCount),
    comments: toCount(raw.commentsCount),
  }
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- normalize-item`
Ожидаем: `9 passed`.

- [ ] **Шаг 5: Прогнать на настоящих фикстурах**

Дописать тест, который читает каждый файл из `fixtures/apify/` и проверяет, что
`normalizeApifyItem` возвращает не `null` и `shortcode` непустой. Это ловит расхождение
между ожидаемой формой ответа и фактической — форматы у акторов меняются.

- [ ] **Шаг 6: Коммит**

```bash
git add src/lib/instagram fixtures && git commit -m "feat: normalize apify dataset items with tests"
```

---

### Задача 4: Схема БД и миграции

**Файлы:**
- Создать: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`
- Создать: `src/db/migrations/` (генерируется)

**Интерфейсы:**
- Отдаёт наружу: `db` (клиент Drizzle), таблицы `users`, `reels`, `reelSnapshots`,
  `reelThumbnails`, `syncRuns`, `apifyUsage`. Используется всеми последующими задачами.

- [ ] **Шаг 1: Описать схему**

`src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  bigint, bigserial, customType, index, integer, numeric,
  pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

/** У Drizzle нет встроенного bytea — объявляем свой тип. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => 'bytea',
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  instagramHandle: text('instagram_handle'),
  avatarUrl: text('avatar_url'),
  role: text('role', { enum: ['blogger', 'admin'] }).notNull().default('blogger'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const reels = pgTable('reels', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  shortcode: text('shortcode').notNull(),
  url: text('url').notNull(),
  caption: text('caption'),
  ownerUsername: text('owner_username'),
  thumbnailSrc: text('thumbnail_src'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  durationSec: numeric('duration_sec', { precision: 6, scale: 2 }),
  syncStatus: text('sync_status', { enum: ['pending', 'ok', 'failed', 'unavailable'] })
    .notNull().default('pending'),
  syncError: text('sync_error'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  nextSyncAt: timestamp('next_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_reels_user_shortcode').on(t.userId, t.shortcode),
  index('idx_reels_user').on(t.userId),
  // Частичный индекс: мёртвые рилсы незачем опрашивать вечно.
  index('idx_reels_due').on(t.nextSyncAt).where(sql`sync_status <> 'unavailable'`),
])

/** Временной ряд. Строка пишется ТОЛЬКО если метрики отличаются от предыдущей. */
export const reelSnapshots = pgTable('reel_snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  reelId: uuid('reel_id').notNull().references(() => reels.id, { onDelete: 'cascade' }),
  views: bigint('views', { mode: 'number' }),
  plays: bigint('plays', { mode: 'number' }),
  likes: bigint('likes', { mode: 'number' }),
  comments: bigint('comments', { mode: 'number' }),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_snapshots_reel_ts').on(t.reelId, t.capturedAt.desc()),
])

/** Отдельная таблица, а не колонка в reels: иначе SELECT * по ленте тащит мегабайты. */
export const reelThumbnails = pgTable('reel_thumbnails', {
  reelId: uuid('reel_id').primaryKey().references(() => reels.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
  mime: text('mime').notNull().default('image/webp'),
  width: integer('width'),
  height: integer('height'),
  bytes: integer('bytes').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const syncRuns = pgTable('sync_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  reelId: uuid('reel_id').references(() => reels.id, { onDelete: 'cascade' }),
  apifyRunId: text('apify_run_id'),
  status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

/** Предохранитель бюджета Apify, см. PLAN.md §7. */
export const apifyUsage = pgTable('apify_usage', {
  period: text('period').primaryKey(), // 'YYYY-MM'
  results: integer('results').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Шаг 1b: Клиент БД**

`src/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// prepare: false — обязательно для пулера Neon в serverless.
const client = postgres(process.env.DATABASE_URL!, { prepare: false })

export const db = drizzle(client, { schema })
export * from './schema'
```

- [ ] **Шаг 2: Настроить `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Шаг 3: Сгенерировать и применить миграцию**

```bash
npx drizzle-kit generate && npx drizzle-kit migrate
```

- [ ] **Шаг 4: Проверить, что таблицы создались**

```bash
npx drizzle-kit studio
```

Ожидаем: шесть таблиц, `reels` содержит `next_sync_at` и `last_synced_at`.

- [ ] **Шаг 5: Коммит**

```bash
git add src/db drizzle.config.ts && git commit -m "feat: database schema and migrations"
```

---

### Задача 5: Сессии на `jose`

**Файлы:**
- Создать: `src/lib/auth/session.ts`
- Тест: `src/lib/auth/session.test.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  type Session = { userId: string; role: 'blogger' | 'admin' }
  function signSession(session: Session): Promise<string>
  function verifySession(token: string | undefined): Promise<Session | null>
  ```
  `verifySession` вызывается из `middleware.ts` (Edge) и из route handlers (Node) —
  поэтому в этом файле **не может быть ни одного импорта из `node:`**.

- [ ] **Шаг 1: Написать падающие тесты**

`src/lib/auth/session.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { signSession, verifySession } from './session'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long'
})

describe('сессия', () => {
  it('подписывает и читает обратно', async () => {
    const token = await signSession({ userId: 'u-1', role: 'admin' })
    expect(await verifySession(token)).toEqual({ userId: 'u-1', role: 'admin' })
  })

  it('отвергает подделанный токен', async () => {
    const token = await signSession({ userId: 'u-1', role: 'blogger' })
    expect(await verifySession(token.slice(0, -3) + 'aaa')).toBeNull()
  })

  it('отвергает мусор и пустоту', async () => {
    expect(await verifySession('не-токен')).toBeNull()
    expect(await verifySession(undefined)).toBeNull()
  })
})
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- session`
Ожидаем: FAIL, модуль не найден.

- [ ] **Шаг 3: Реализовать**

`src/lib/auth/session.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose'

export type Session = { userId: string; role: 'blogger' | 'admin' }

const ALG = 'HS256'
const TTL = '30d'

/** Ленивое чтение: в Edge переменные окружения доступны только в рантайме. */
function secret(): Uint8Array {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET не задан')
  return new TextEncoder().encode(value)
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret())
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] })
    if (!payload.sub) return null
    const role = payload.role === 'admin' ? 'admin' : 'blogger'
    return { userId: payload.sub, role }
  } catch {
    return null
  }
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- session`
Ожидаем: `3 passed`.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/auth && git commit -m "feat: jwt sessions via jose"
```

---

### Задача 6: Роуты регистрации и входа

**Файлы:**
- Создать: `src/app/api/auth/register/route.ts`, `src/app/api/auth/login/route.ts`,
  `src/app/api/auth/logout/route.ts`
- Создать: `src/lib/auth/password.ts`, `src/lib/auth/cookie.ts`

**Интерфейсы:**
- Потребляет: `signSession` (задача 5), `db` и `users` (задача 4).
- Отдаёт наружу: `SESSION_COOKIE = 'pp_session'`, хелперы `setSessionCookie(response, token)`
  и `clearSessionCookie(response)`. Используются задачей 7 и срезом 9 (демо-вход).

- [ ] **Шаг 1: Пароли**

`src/lib/auth/password.ts`:

```ts
// ВНИМАНИЕ: только Node-runtime. Не импортировать из middleware.ts —
// bcryptjs утянет за собой node:crypto и сборка Edge упадёт.
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
```

- [ ] **Шаг 2: Cookie**

`src/lib/auth/cookie.ts`:

```ts
import type { NextResponse } from 'next/server'

export const SESSION_COOKIE = 'pp_session'

const MAX_AGE = 60 * 60 * 24 * 30 // 30 дней, совпадает с TTL токена

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  })
  return response
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
```

- [ ] **Шаг 3: `POST /api/auth/register`**

`src/app/api/auth/register/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, users } from '@/db'
import { hashPassword } from '@/lib/auth/password'
import { signSession } from '@/lib/auth/session'
import { setSessionCookie } from '@/lib/auth/cookie'

export const runtime = 'nodejs' // bcryptjs требует Node

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Проверь email — кажется, в нём опечатка' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Пароль короче 8 символов' }, { status: 400 })
  }
  if (!displayName) {
    return NextResponse.json({ error: 'Как тебя зовут?' }, { status: 400 })
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  if (existing) {
    return NextResponse.json({ error: 'Такой email уже зарегистрирован' }, { status: 409 })
  }

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), displayName })
    .returning({ id: users.id, role: users.role })

  const token = await signSession({ userId: user.id, role: user.role })
  return setSessionCookie(NextResponse.json({ ok: true }, { status: 201 }), token)
}
```

- [ ] **Шаг 4: `POST /api/auth/login`**

`src/app/api/auth/login/route.ts` — та же структура, но:

```ts
const [user] = await db.select().from(users).where(eq(users.email, email))

// Один и тот же текст на неизвестный email и на неверный пароль:
// разные ответы позволяют перебором узнать, кто зарегистрирован.
const invalid = () =>
  NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })

if (!user) return invalid()
if (!(await verifyPassword(password, user.passwordHash))) return invalid()

const token = await signSession({ userId: user.id, role: user.role })
return setSessionCookie(NextResponse.json({ ok: true }), token)
```

- [ ] **Шаг 5: `POST /api/auth/logout`**

```ts
import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/cookie'

export async function POST() {
  return clearSessionCookie(NextResponse.json({ ok: true }))
}
```

- [ ] **Шаг 6: Проверить руками**

```bash
curl -i -X POST localhost:3000/api/auth/register -H 'content-type: application/json' -d '{"email":"a@b.ru","password":"12345678","displayName":"Тест"}'
```

Ожидаем: 201 и заголовок `Set-Cookie: pp_session=...; HttpOnly`.

- [ ] **Шаг 7: Коммит**

```bash
git add src/app/api/auth src/lib/auth && git commit -m "feat: register, login and logout endpoints"
```

---

### Задача 7: Middleware и защита `/app`

**Файлы:**
- Создать: `src/middleware.ts`
- Создать: `src/lib/auth/require-session.ts`
- Создать: `src/app/app/page.tsx` (заглушка «Привет, {имя}»)

**Интерфейсы:**
- Потребляет: `verifySession` (задача 5), `SESSION_COOKIE` (задача 6).
- Отдаёт наружу: `requireSession(): Promise<Session>` — бросает 401 в route handlers.
  Используется всеми эндпоинтами данных в срезах 3–7.

- [ ] **Шаг 1: Написать middleware**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/cookie'
import { verifySession } from '@/lib/auth/session'

export async function middleware(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  const url = new URL('/login', request.url)
  url.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/app/:path*'] }
```

- [ ] **Шаг 2: Проверить, что Edge не падает**

Запустить `npm run build`.
Ожидаем: сборка проходит. Если в консоли появилось `Module not found: Can't resolve 'crypto'` —
значит в граф импортов middleware просочился Node-модуль (чаще всего `bcryptjs`
через общий barrel-файл). Разорвать импорт, а не добавлять полифилл.

- [ ] **Шаг 3: Проверить редирект**

Открыть `/app` в инкогнито.
Ожидаем: редирект на `/login?next=/app`.

- [ ] **Шаг 4: Коммит**

```bash
git add src/middleware.ts src/lib/auth src/app/app && git commit -m "feat: protect /app via edge middleware"
```

---

### Задача 8: Тест изоляции данных

Прямое требование ТЗ — «разные аккаунты». Проверяется не глазами, а тестом.

**Файлы:**
- Создать: `src/lib/auth/ownership.ts`
- Тест: `src/lib/auth/ownership.test.ts`

**Интерфейсы:**
- Отдаёт наружу: `assertOwned<T>(row: T | undefined, session: Session): T` — бросает
  ошибку с кодом 404 (не 403), если `row.userId !== session.userId`.
  Обязателен к вызову во всех эндпоинтах срезов 3–7.

- [ ] **Шаг 1: Написать падающие тесты**

```ts
import { describe, expect, it } from 'vitest'
import { assertOwned, NotFoundError } from './ownership'

const session = { userId: 'u-1', role: 'blogger' as const }

describe('assertOwned', () => {
  it('пропускает свою запись', () => {
    const row = { id: 'r-1', userId: 'u-1' }
    expect(assertOwned(row, session)).toBe(row)
  })

  it('прячет чужую запись как 404, а не 403', () => {
    expect(() => assertOwned({ id: 'r-2', userId: 'u-2' }, session)).toThrow(NotFoundError)
  })

  it('несуществующую запись отдаёт тем же 404', () => {
    expect(() => assertOwned(undefined, session)).toThrow(NotFoundError)
  })
})
```

> Третий тест — не формальность. Чужая и несуществующая запись должны быть
> **неразличимы снаружи**: 403 на чужой подтверждает, что она существует.

- [ ] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- ownership`

- [ ] **Шаг 3: Реализовать**

```ts
import type { Session } from './session'

export class NotFoundError extends Error {
  readonly status = 404
  constructor() {
    super('Не найдено')
  }
}

export function assertOwned<T extends { userId: string }>(
  row: T | undefined | null,
  session: Session,
): T {
  if (!row || row.userId !== session.userId) throw new NotFoundError()
  return row
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test`
Ожидаем: все тесты среза зелёные.

- [ ] **Шаг 5: Задеплоить и проверить**

```bash
git add -A && git commit -m "feat: data ownership guard" && git push
```

Открыть прод: регистрация работает, `/app` под гостем редиректит на `/login`.

---

## Готовность среза

Срез считается закрытым, когда одновременно верно:

- [ ] `npm test` — зелёный, покрыты нормализация URL, метрик, сессии и владение
- [ ] `npm run build` — проходит без ошибок Edge-runtime
- [ ] На проде можно зарегистрироваться и попасть в `/app`
- [ ] `/app` под гостем редиректит на `/login`
- [ ] Прод открывается **с телефона, с мобильного интернета, без VPN**
- [ ] Ни одного живого вызова Apify — кредиты нетронуты
