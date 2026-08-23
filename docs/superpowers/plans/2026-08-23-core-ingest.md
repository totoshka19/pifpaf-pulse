# PifPaf Pulse — срез 3: ядро приёма рилсов

> **Для исполнителя:** используй `superpowers:subagent-driven-development` (рекомендуется)
> или `superpowers:executing-plans`, чтобы выполнять план задача за задачей.
> Шаги размечены чекбоксами (`- [ ]`) для отслеживания прогресса.

**Цель:** блогер вставляет ссылку на рилс — в базе появляются реальные данные
из Apify: просмотры, дата, автор, подпись, ссылка на обложку и первый снапшот метрик.
После этого среза ТЗ выполнено в главном.

**Архитектура:** ни один HTTP-запрос не ждёт Apify. `POST /api/reels` проверяет
ссылку, дедуп и бюджет, создаёт запись в статусе `pending`, запускает прогон
и отвечает `202`. Фронт опрашивает `GET /api/reels/:id`; этот же эндпоинт при каждом
обращении проверяет статус прогона в Apify и, когда тот завершён, забирает датасет
и записывает данные. Разработка идёт на фикстурах (`APIFY_MOCK=1`), кредиты
тратятся один раз в конце для сверки.

**Тех.стек:** Next.js 16 route handlers (Node runtime), Drizzle, `postgres.js`, Vitest.

**Спека:** [`PLAN.md`](../../../PLAN.md) — §1 (бюджет), §3 (архитектура), §5 (нормализация
ссылок), §6 (поля актора), §7 (адаптивный синк), §8 (схема), §9 (эндпоинты).

**Предыдущий срез:** [`2026-08-23-foundation.md`](2026-08-23-foundation.md) — закрыт.

## Глобальные ограничения

- **10 секунд на функцию.** Netlify free обрывает синхронную функцию через 10 с,
  background-функций нет. Ни один запрос не ждёт Apify. См. `PLAN.md` §1.
- **Бюджет Apify: ≈1850 результатов в месяц.** В ТЗ прямо сказано «бесплатки хватит» —
  выход за лимит это провал условия задачи, а не перерасход.
- **Разработка на фикстурах.** `APIFY_MOCK=1` — значение по умолчанию в `.env.local`.
  Живые вызовы только в задаче 9, осознанно, с подсчётом.
- ORM — **Drizzle**, не Prisma. Аналитика — сырым SQL в `src/db/queries/`.
- Изоляция данных: каждый эндпоинт зовёт `requireSession()` и `assertOwned()`.
  Чужая запись — **404**, не 403.
- Тексты ошибок — **на русском, на «ты»**, готовые к показу.
- `null` ≠ `0`. Отсутствующая метрика показывается как «—».
- Время в интерфейсе и группировках — **`Europe/Moscow`**.
- `APIFY_TOKEN` — только серверная переменная.

## Что сознательно НЕ входит в срез

| Что | Куда переехало | Почему |
|---|---|---|
| Скачивание обложек в `bytea` | срез 4 | `thumbnailSrc` пока хранится как есть; ссылка живёт ~4,5 суток (`PLAN.md` §6), этого хватает, чтобы срез 3 успел закрыться |
| Кнопка «Обновить» и `POST /api/reels/:id/sync` | срез 7 | относится к синхронизации, а не к первичному приёму |
| Крон и батчинг | срез 7 | там же и ограничение в 10 секунд на размер батча |
| `POST /api/apify/webhook` | не делаем | схема с опросом карточки закрывает ту же задачу без публичного эндпоинта и общего секрета. Вернуться, только если опрос окажется недостаточным |
| Интерфейс ленты | срез 5 | здесь достаточно API и проверки скриптом |

## Статус: задачи 1–4 выполнены

`npm test` → **101 passed**. `npm run test:db` → **21 passed** на живой базе.
`npm run build` → проходит. Коммиты `f6a4c12`, `b057559`, `0bd1dd9`, `efeab62`.

### Отклонения от плана

| Записано в плане | Сделано | Причина |
|---|---|---|
| Все четыре функции бюджета в `src/lib/apify/budget.ts` | **Разделено**: чистые `currentPeriod`/`monthlyCap` в `src/lib/apify/budget.ts`, работа с базой `tryReserve`/`usage` в `src/db/queries/budget.ts` | `@/db` бросает исключение при импорте без `DATABASE_URL`, а vitest `.env.local` не читает. Юнит-тест на формат строки `'2026-08'` падал бы из-за отсутствия базы. Заодно соответствует конвенции из `AGENTS.md`: запросы живут в `src/db/queries/`. |
| `scripts/verify-budget.mjs` — отдельный скрипт | **Интеграционный тест** `src/db/queries/budget.integration.test.ts` + конфиг `vitest.integration.mts` + `npm run test:db` | Скрипт на `.mjs` не может импортировать `.ts` по алиасу `@/`, поэтому **дублировал бы SQL**. Тест, проверяющий копию проверяемого кода, — ложная уверенность: правку в приложении он не заметит. Vitest резолвит и алиас, и типы, поэтому вызывается настоящая `tryReserve`. |
| Тестов на расписание: 10 | **16** | Добавлены точные границы ступеней (ровно 48 ч, ровно неделя, ровно месяц), проверка на отсутствие мутации входных дат и контроль соотношения частот. |
| Тестов на бюджет: 6 | **11 юнит + 9 интеграционных** | Добавлены границы года в MSK, отрицательный и нулевой лимит, проверка, что лимит держится ниже реального потолка 1850. |
| Тестов на клиент Apify: 8 | **12** | Добавлены батч из нескольких ссылок, пустой список, `APIFY_MOCK=0` без токена, отсечение query-хвоста при разборе shortcode. |
| Задача 4, шаг 2: `scripts/verify-ingest.mjs` | **Интеграционный тест** `src/db/queries/ingest.integration.test.ts`, 12 случаев | По той же причине, что и с бюджетом: скрипт дублировал бы логику вместо вызова настоящей `ingestReel`. Инфраструктура уже была построена в задаче 2. |
| Задача 4: 5 сценариев проверки | **12** | Добавлены: перенос метрик в снапшот, десять одинаковых опросов подряд, изменение одних только лайков, датасет с **чужим** shortcode, выбор своего элемента из батча, несуществующий рилс. |

### Проверка тестов на зубы

| Что ломали | Результат |
|---|---|
| Убрали фильтрацию по shortcode в моке `getDatasetItems` | **Упало 4 теста из 12.** Тесты проверяют выборку, а не факт возврата данных. |
| Условие лимита вынесено бы из SQL в JS | Ловится интеграционным тестом: из 10 параллельных резерваций должна проходить ровно 1. Проверено на живой базе — проходит 1, счётчик останавливается ровно на `cap`. |
| Убрали правило «снапшот только при изменении» из `ingestReel` | **Упало 2 теста.** Главное правило среза защищено: и одиночный повтор, и десять одинаковых опросов подряд ловят регрессию. |

## Что уже готово из среза 1

Это переиспользуется, писать заново не нужно:

| Модуль | Что делает |
|---|---|
| `src/lib/instagram/normalize-url.ts` | `normalizeReelUrl(input)` → `{ok, shortcode, canonicalUrl}` \| `{ok:false, reason}` |
| `src/lib/instagram/normalize-item.ts` | `normalizeApifyItem(raw)` → `ReelData \| null` |
| `src/lib/auth/require-session.ts` | `requireSession()`, `getSession()` |
| `src/lib/auth/ownership.ts` | `assertOwned(row, session)`, `NotFoundError` |
| `src/db/schema.ts` | `reels`, `reelSnapshots`, `syncRuns`, `apifyUsage` |
| `fixtures/apify/*.json` | 3 реальных рилса для `APIFY_MOCK=1` |

---

### ✅ Задача 1: Адаптивное расписание опроса

Чистая функция без зависимостей — идёт первой, как `normalizeReelUrl` в прошлом срезе.

**Файлы:**
- Создать: `src/lib/sync/schedule.ts`
- Тест: `src/lib/sync/schedule.test.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  function computeNextSyncAt(postedAt: Date | null, now: Date): Date
  ```
  Используется задачей 5 (запись данных) и срезом 7 (крон).

- [x] **Шаг 1: Написать падающие тесты**

`src/lib/sync/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeNextSyncAt } from './schedule'

const NOW = new Date('2026-08-23T12:00:00.000Z')
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000
const agoHours = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('computeNextSyncAt — интервал зависит от возраста рилса', () => {
  const cases: [string, Date, number][] = [
    ['свежий, 1 час',        agoHours(1),        1],
    ['на границе 48 часов',  agoHours(47),       1],
    ['3 дня',                agoHours(72),       6],
    ['на границе недели',    agoHours(24 * 6),   6],
    ['две недели',           agoHours(24 * 14),  24],
    ['на границе месяца',    agoHours(24 * 29),  24],
    ['полгода',              agoHours(24 * 180), 24 * 7],
  ]

  it.each(cases)('%s → следующий опрос через %d ч', (_name, postedAt, expected) => {
    expect(hoursBetween(NOW, computeNextSyncAt(postedAt, NOW))).toBeCloseTo(expected, 5)
  })
})

describe('computeNextSyncAt — граничные случаи', () => {
  it('без даты публикации считает рилс свежим', () => {
    // Дата ещё не пришла (sync_status='pending'). Опросить скоро — она появится.
    expect(hoursBetween(NOW, computeNextSyncAt(null, NOW))).toBeCloseTo(1, 5)
  })

  it('дата из будущего не ломает расчёт', () => {
    const future = new Date(NOW.getTime() + 3_600_000)
    expect(hoursBetween(NOW, computeNextSyncAt(future, NOW))).toBeCloseTo(1, 5)
  })

  it('всегда возвращает момент в будущем', () => {
    for (const h of [0, 1, 100, 10_000]) {
      expect(computeNextSyncAt(agoHours(h), NOW).getTime()).toBeGreaterThan(NOW.getTime())
    }
  })
})
```

- [x] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- schedule`
Ожидаем: FAIL, `Cannot find module './schedule'`.

- [x] **Шаг 3: Реализовать**

`src/lib/sync/schedule.ts`:

```ts
/**
 * Когда опрашивать рилс в следующий раз.
 *
 * Просмотры растут по кривой с насыщением: взрыв первые двое суток, потом плато.
 * Опрашивать месячный рилс раз в час — платить за 24 одинаковых ответа в сутки.
 * Расчёт бюджета — PLAN.md §7: адаптивная частота даёт ~520 результатов в месяц
 * против 43 200 при фиксированном часе.
 */

const HOUR = 3_600_000

/** Возраст рилса в часах → интервал до следующего опроса в часах. */
const LADDER: [maxAgeHours: number, intervalHours: number][] = [
  [48, 1],
  [24 * 7, 6],
  [24 * 30, 24],
  [Infinity, 24 * 7],
]

export function computeNextSyncAt(postedAt: Date | null, now: Date): Date {
  // Даты ещё нет (запись в pending) или она из будущего из-за расхождения часов —
  // считаем рилс свежим и опрашиваем скоро.
  const ageHours =
    postedAt && postedAt.getTime() < now.getTime()
      ? (now.getTime() - postedAt.getTime()) / HOUR
      : 0

  const interval = LADDER.find(([maxAge]) => ageHours < maxAge)![1]

  return new Date(now.getTime() + interval * HOUR)
}
```

- [x] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- schedule`
Ожидаем: `10 passed`.

- [x] **Шаг 5: Коммит**

```bash
git add src/lib/sync && git commit -m "feat: adaptive sync schedule by reel age"
```

---

### ✅ Задача 2: Предохранитель бюджета Apify

Одного расписания мало: ошибка в выборке за ночь сожжёт месячный лимит.

**Файлы:**
- Создать: `src/lib/apify/budget.ts`
- Тест: `src/lib/apify/budget.test.ts`

**Интерфейсы:**
- Потребляет: таблицу `apifyUsage` (задача 4 среза 1).
- Отдаёт наружу:
  ```ts
  function currentPeriod(now: Date): string            // 'YYYY-MM' в MSK
  function monthlyCap(): number                        // из APIFY_MONTHLY_CAP
  async function tryReserve(count: number): Promise<boolean>
  async function usage(): Promise<{ period: string; used: number; cap: number }>
  ```
  `tryReserve` атомарно увеличивает счётчик и возвращает `false`, если лимит исчерпан.
  Используется задачами 6 и 7, а также срезом 7 (крон).

- [x] **Шаг 1: Написать тест на чистую часть**

`src/lib/apify/budget.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { currentPeriod, monthlyCap } from './budget'

afterEach(() => {
  delete process.env.APIFY_MONTHLY_CAP
})

describe('currentPeriod — ключ считается по московскому времени', () => {
  it('форматирует как YYYY-MM', () => {
    expect(currentPeriod(new Date('2026-08-23T12:00:00Z'))).toBe('2026-08')
  })

  it('однозначные месяцы дополняет нулём', () => {
    expect(currentPeriod(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01')
  })

  it('учитывает сдвиг MSK на границе месяца', () => {
    // 31 августа 23:00 UTC = 1 сентября 02:00 в Москве → период уже сентябрьский.
    expect(currentPeriod(new Date('2026-08-31T23:00:00Z'))).toBe('2026-09')
  })
})

describe('monthlyCap', () => {
  it('читает APIFY_MONTHLY_CAP', () => {
    process.env.APIFY_MONTHLY_CAP = '1500'
    expect(monthlyCap()).toBe(1500)
  })

  it('без переменной берёт консервативное значение', () => {
    expect(monthlyCap()).toBe(1500)
  })

  it('мусор в переменной не превращает лимит в NaN', () => {
    process.env.APIFY_MONTHLY_CAP = 'много'
    expect(monthlyCap()).toBe(1500)
  })
})
```

- [x] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- budget`

- [x] **Шаг 3: Реализовать**

`src/lib/apify/budget.ts`:

```ts
import { sql } from 'drizzle-orm'
import { apifyUsage, db } from '@/db'

/**
 * Предохранитель расхода Apify. PLAN.md §1 и §7.
 *
 * Free tier: $5/мес ÷ $2.70 за 1000 результатов ≈ 1850 синхронизаций.
 * APIFY_MONTHLY_CAP держим ниже реального потолка, чтобы остался буфер.
 */

const DEFAULT_CAP = 1500

/** Ключ периода в московском времени: месяц не должен «переключаться» ночью по UTC. */
export function currentPeriod(now: Date): string {
  const msk = new Date(now.getTime() + 3 * 3_600_000)
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthlyCap(): number {
  const parsed = Number.parseInt(process.env.APIFY_MONTHLY_CAP ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP
}

/**
 * Атомарно резервирует `count` результатов. Возвращает false, если не влезает.
 *
 * Вся проверка и инкремент — одним запросом. Читать текущее значение, сравнивать
 * в JS и потом писать нельзя: два параллельных добавления рилса прочитают одно
 * и то же число и оба решат, что бюджет есть.
 */
export async function tryReserve(count: number, now = new Date()): Promise<boolean> {
  const period = currentPeriod(now)
  const cap = monthlyCap()

  const rows = await db.execute(sql`
    INSERT INTO apify_usage (period, results, updated_at)
    VALUES (${period}, ${count}, now())
    ON CONFLICT (period) DO UPDATE
      SET results = apify_usage.results + ${count},
          updated_at = now()
      WHERE apify_usage.results + ${count} <= ${cap}
    RETURNING results
  `)

  // Пустой результат = условие WHERE не выполнилось = лимит исчерпан.
  return rows.length > 0
}

export async function usage(now = new Date()) {
  const period = currentPeriod(now)
  const [row] = await db
    .select()
    .from(apifyUsage)
    .where(sql`${apifyUsage.period} = ${period}`)

  return { period, used: row?.results ?? 0, cap: monthlyCap() }
}
```

- [x] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- budget`
Ожидаем: `6 passed`.

- [x] **Шаг 5: Проверить атомарность на живой базе**

Создать `scripts/verify-budget.mjs`: в транзакции с откатом выставить `results`
на `cap - 1`, запустить **десять параллельных** `tryReserve(1)` через `Promise.all`
и убедиться, что ровно один вернул `true`.

Запустить: `node --env-file=.env.local scripts/verify-budget.mjs`
Ожидаем: `успешных резерваций: 1 из 10`.

> Если успешных больше одной — условие ушло из SQL в JS. Это тот случай, когда
> тест на моках ничего не докажет: гонку видно только на настоящей базе.

- [x] **Шаг 6: Коммит**

```bash
git add src/lib/apify scripts && git commit -m "feat: atomic apify budget guard"
```

---

### ✅ Задача 3: Клиент Apify в режиме мока

**Файлы:**
- Создать: `src/lib/apify/client.ts`
- Тест: `src/lib/apify/client.test.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  type RunHandle = { runId: string; datasetId: string | null; status: RunStatus }
  type RunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED'

  function isMock(): boolean
  async function startRun(urls: string[]): Promise<RunHandle>
  async function getRun(runId: string): Promise<RunHandle>
  async function getDatasetItems(datasetId: string): Promise<unknown[]>
  ```
  Используется задачами 6 и 7.

- [x] **Шаг 1: Написать падающие тесты**

`src/lib/apify/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDatasetItems, getRun, isMock, startRun } from './client'

beforeEach(() => {
  process.env.APIFY_MOCK = '1'
})

afterEach(() => {
  delete process.env.APIFY_MOCK
  delete process.env.APIFY_TOKEN
})

describe('режим мока', () => {
  it('включается по APIFY_MOCK=1', () => {
    expect(isMock()).toBe(true)
  })

  it('выключается при APIFY_MOCK=0', () => {
    process.env.APIFY_MOCK = '0'
    process.env.APIFY_TOKEN = 'x'
    expect(isMock()).toBe(false)
  })

  it('включается сам, если токена нет — чтобы разработка не падала', () => {
    delete process.env.APIFY_MOCK
    expect(isMock()).toBe(true)
  })
})

describe('прогон в режиме мока', () => {
  it('startRun сразу отдаёт завершённый прогон', async () => {
    const run = await startRun(['https://www.instagram.com/reel/DcXVbOOiyhL/'])
    expect(run.status).toBe('SUCCEEDED')
    expect(run.runId).toBeTruthy()
    expect(run.datasetId).toBeTruthy()
  })

  it('getRun возвращает тот же прогон', async () => {
    const started = await startRun(['https://www.instagram.com/reel/DcXVbOOiyhL/'])
    const fetched = await getRun(started.runId)
    expect(fetched.status).toBe('SUCCEEDED')
  })

  it('датасет отдаёт элементы из фикстур', async () => {
    const run = await startRun(['https://www.instagram.com/reel/DcXVbOOiyhL/'])
    const items = await getDatasetItems(run.datasetId!)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toHaveProperty('shortCode')
  })

  it('отдаёт элемент с запрошенным shortcode, если он есть в фикстурах', async () => {
    const run = await startRun(['https://www.instagram.com/reel/DcXVbOOiyhL/'])
    const items = (await getDatasetItems(run.datasetId!)) as Record<string, unknown>[]
    expect(items.some((i) => i.shortCode === 'DcXVbOOiyhL')).toBe(true)
  })

  it('на неизвестный shortcode отдаёт пустой датасет — как приватный рилс', async () => {
    const run = await startRun(['https://www.instagram.com/reel/НетТакого/'])
    const items = await getDatasetItems(run.datasetId!)
    expect(items).toEqual([])
  })
})
```

> Последний тест важнее, чем кажется: **пустой датасет — это штатный ответ Apify
> на приватный или удалённый рилс**, а не ошибка. Мок обязан уметь его воспроизводить,
> иначе ветка `sync_status='unavailable'` останется непроверенной до прода.

- [x] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- apify/client`

- [x] **Шаг 3: Реализовать**

`src/lib/apify/client.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Клиент Apify с двумя режимами.
 *
 * Мок читает fixtures/apify/*.json и подбирает элементы по shortcode из URL.
 * Живой режим работает АСИНХРОННО: запускает прогон и сразу возвращает runId.
 * Синхронный run-sync-get-dataset-items не применим — Netlify free обрывает
 * функцию через 10 секунд, а прогон идёт 30–60. См. PLAN.md §1.
 */

export type RunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED'
export type RunHandle = { runId: string; datasetId: string | null; status: RunStatus }

const API = 'https://api.apify.com/v2'
const MOCK_PREFIX = 'mock:'

export function isMock(): boolean {
  if (process.env.APIFY_MOCK === '1') return true
  if (process.env.APIFY_MOCK === '0') return false
  // Токена нет — молча падать на каждом запросе хуже, чем работать на фикстурах.
  return !process.env.APIFY_TOKEN
}

function actorId(): string {
  return process.env.APIFY_ACTOR_ID ?? 'apify~instagram-scraper'
}

function token(): string {
  const value = process.env.APIFY_TOKEN
  if (!value) throw new Error('APIFY_TOKEN не задан')
  return value
}

/** Все элементы из всех файлов fixtures/apify/. */
function fixtureItems(): Record<string, unknown>[] {
  const dir = join(process.cwd(), 'fixtures', 'apify')
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      return Array.isArray(parsed) ? parsed : [parsed]
    })
}

/** В моке runId несёт в себе запрошенные shortcode — состояние хранить негде. */
function shortcodesFrom(urls: string[]): string[] {
  return urls.map((u) => u.split('/').filter(Boolean).pop() ?? '')
}

export async function startRun(urls: string[]): Promise<RunHandle> {
  if (isMock()) {
    const id = MOCK_PREFIX + shortcodesFrom(urls).join(',')
    return { runId: id, datasetId: id, status: 'SUCCEEDED' }
  }

  const response = await fetch(`${API}/acts/${actorId()}/runs?token=${token()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resultsType: 'posts',
      directUrls: urls,
      resultsLimit: 1,
    }),
  })

  if (!response.ok) {
    throw new Error(`Apify не принял запуск: ${response.status}`)
  }

  const { data } = await response.json()
  return {
    runId: data.id,
    datasetId: data.defaultDatasetId ?? null,
    status: data.status,
  }
}

export async function getRun(runId: string): Promise<RunHandle> {
  if (runId.startsWith(MOCK_PREFIX)) {
    return { runId, datasetId: runId, status: 'SUCCEEDED' }
  }

  const response = await fetch(`${API}/actor-runs/${runId}?token=${token()}`)
  if (!response.ok) throw new Error(`Apify не отдал статус прогона: ${response.status}`)

  const { data } = await response.json()
  return {
    runId: data.id,
    datasetId: data.defaultDatasetId ?? null,
    status: data.status,
  }
}

export async function getDatasetItems(datasetId: string): Promise<unknown[]> {
  if (datasetId.startsWith(MOCK_PREFIX)) {
    const wanted = new Set(datasetId.slice(MOCK_PREFIX.length).split(','))
    return fixtureItems().filter((item) => wanted.has(String(item.shortCode)))
  }

  const response = await fetch(`${API}/datasets/${datasetId}/items?token=${token()}`)
  if (!response.ok) throw new Error(`Apify не отдал датасет: ${response.status}`)

  return response.json()
}
```

- [x] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- apify/client`
Ожидаем: `8 passed`.

- [x] **Шаг 5: Коммит**

```bash
git add src/lib/apify && git commit -m "feat: apify client with fixture-backed mock mode"
```

---

### ✅ Задача 4: Запись результата в базу

Сердце среза: превращение элемента датасета в строки таблиц.

**Файлы:**
- Создать: `src/db/queries/ingest.ts`
- Создать: `scripts/verify-ingest.mjs`

**Интерфейсы:**
- Потребляет: `normalizeApifyItem` (срез 1), `computeNextSyncAt` (задача 1).
- Отдаёт наружу:
  ```ts
  type IngestResult = { status: 'ok' | 'unavailable'; snapshotWritten: boolean }
  async function ingestReel(reelId: string, items: unknown[]): Promise<IngestResult>
  ```
  Используется задачами 6 и 7.

- [x] **Шаг 1: Реализовать**

`src/db/queries/ingest.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm'
import { db, reels, reelSnapshots } from '@/db'
import { normalizeApifyItem } from '@/lib/instagram/normalize-item'
import { computeNextSyncAt } from '@/lib/sync/schedule'

export type IngestResult = { status: 'ok' | 'unavailable'; snapshotWritten: boolean }

/**
 * Записывает результат прогона Apify для одного рилса.
 *
 * Два правила, без которых история метрик разваливается (PLAN.md §3):
 *  1. `last_synced_at` обновляется ВСЕГДА — это доказательство свежести данных.
 *  2. Строка в `reel_snapshots` пишется ТОЛЬКО если метрики изменились. Иначе
 *     при опросе раз в час график роста превращается в лестницу из одинаковых
 *     точек, а таблица растёт на сотни строк в сутки без новой информации.
 */
export async function ingestReel(
  reelId: string,
  items: unknown[],
  now = new Date(),
): Promise<IngestResult> {
  const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
  if (!reel) throw new Error('Рилс не найден')

  const data = items.map(normalizeApifyItem).find((d) => d?.shortcode === reel.shortcode)

  // Пустой датасет — штатный ответ Apify на приватный или удалённый рилс.
  if (!data) {
    await db
      .update(reels)
      .set({
        syncStatus: 'unavailable',
        syncError: 'Рилс недоступен: приватный аккаунт или запись удалена',
        lastSyncedAt: now,
        nextSyncAt: null, // больше не опрашиваем, частичный индекс его исключит
      })
      .where(eq(reels.id, reelId))

    return { status: 'unavailable', snapshotWritten: false }
  }

  await db
    .update(reels)
    .set({
      caption: data.caption,
      ownerUsername: data.ownerUsername,
      thumbnailSrc: data.thumbnailSrc,
      postedAt: data.postedAt,
      durationSec: data.durationSec === null ? null : String(data.durationSec),
      syncStatus: 'ok',
      syncError: null,
      lastSyncedAt: now,
      nextSyncAt: computeNextSyncAt(data.postedAt, now),
    })
    .where(eq(reels.id, reelId))

  const [last] = await db
    .select()
    .from(reelSnapshots)
    .where(eq(reelSnapshots.reelId, reelId))
    .orderBy(desc(reelSnapshots.capturedAt))
    .limit(1)

  const unchanged =
    last &&
    last.views === data.views &&
    last.plays === data.plays &&
    last.likes === data.likes &&
    last.comments === data.comments

  if (unchanged) return { status: 'ok', snapshotWritten: false }

  await db.insert(reelSnapshots).values({
    reelId,
    views: data.views,
    plays: data.plays,
    likes: data.likes,
    comments: data.comments,
    capturedAt: now,
  })

  return { status: 'ok', snapshotWritten: true }
}
```

- [x] **Шаг 2: Написать проверку на живой базе**

`scripts/verify-ingest.mjs` — всё в транзакции с откатом:

1. создать пользователя и рилс в статусе `pending`;
2. вызвать `ingestReel` с элементом из фикстур → ожидаем `snapshotWritten: true`,
   `sync_status='ok'`, заполненные `caption`, `posted_at`, `next_sync_at`;
3. вызвать **повторно с теми же данными** → ожидаем `snapshotWritten: false`,
   а `last_synced_at` при этом **обновился**;
4. вызвать с изменённым `videoPlayCount` → ожидаем `snapshotWritten: true`
   и ровно две строки в `reel_snapshots`;
5. вызвать с пустым массивом → ожидаем `sync_status='unavailable'` и `next_sync_at = NULL`.

- [x] **Шаг 3: Прогнать проверку**

Запустить: `node --env-file=.env.local scripts/verify-ingest.mjs`
Ожидаем все пять пунктов зелёными и ноль строк после отката.

> Пункт 3 — главный. Именно он отличает работающую историю метрик от таблицы,
> забитой дублями. Проверять его на моках бессмысленно: правило живёт в SQL.

- [x] **Шаг 4: Коммит**

```bash
git add src/db/queries scripts && git commit -m "feat: ingest apify results with change-only snapshots"
```

---

### Задача 5: Общие ответы API

Мелочь, которая экономит время в задачах 6–8 и держит формат ошибок единым.

**Файлы:**
- Создать: `src/lib/api/respond.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  function ok<T>(data: T, status?: number): NextResponse
  function fail(message: string, status: number): NextResponse
  function handleError(error: unknown): NextResponse
  ```
  `handleError` превращает `UnauthorizedError` в 401, `NotFoundError` в 404,
  всё остальное — в 500 с человеческим текстом. Используется всеми эндпоинтами среза.

- [ ] **Шаг 1: Реализовать**

```ts
import { NextResponse } from 'next/server'
import { NotFoundError } from '@/lib/auth/ownership'
import { UnauthorizedError } from '@/lib/auth/require-session'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

export function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) return fail('Нужно войти', 401)
  if (error instanceof NotFoundError) return fail('Не найдено', 404)

  // Внутрь наружу не отдаём: текст ошибки может содержать строку подключения.
  console.error('[api]', error)
  return fail('Что-то пошло не так с нашей стороны. Попробуй ещё раз', 500)
}
```

- [ ] **Шаг 2: Коммит**

```bash
git add src/lib/api && git commit -m "feat: shared api response helpers"
```

---

### Задача 6: `POST /api/reels` — приём ссылки

**Файлы:**
- Создать: `src/app/api/reels/route.ts`

**Интерфейсы:**
- Потребляет: `normalizeReelUrl`, `requireSession`, `tryReserve`, `startRun`,
  `computeNextSyncAt`.
- Отдаёт наружу: `POST` → `202 { id, shortcode, syncStatus }` либо ошибку.
  `GET` → список своих рилсов (задача 8 дополнит сортировкой).

- [ ] **Шаг 1: Реализовать POST**

```ts
import { and, eq } from 'drizzle-orm'
import { db, reels, syncRuns } from '@/db'
import { ok, fail, handleError } from '@/lib/api/respond'
import { startRun } from '@/lib/apify/client'
import { tryReserve } from '@/lib/apify/budget'
import { requireSession } from '@/lib/auth/require-session'
import { normalizeReelUrl } from '@/lib/instagram/normalize-url'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const body = await request.json().catch(() => null)

    const parsed = normalizeReelUrl(typeof body?.url === 'string' ? body.url : '')
    if (!parsed.ok) return fail(parsed.reason, 400)

    // Дедуп: тот же рилс у того же блогера добавляется один раз.
    const [existing] = await db
      .select({ id: reels.id })
      .from(reels)
      .where(and(eq(reels.userId, session.userId), eq(reels.shortcode, parsed.shortcode)))

    if (existing) {
      return ok({ id: existing.id, duplicate: true, error: 'Этот рилс уже добавлен' }, 409)
    }

    // Бюджет проверяется ДО запуска прогона: после запуска кредиты уже списаны.
    if (!(await tryReserve(1))) {
      return fail(
        'Лимит обновлений на этот месяц исчерпан. Данные по добавленным рилсам продолжают показываться',
        429,
      )
    }

    const [reel] = await db
      .insert(reels)
      .values({
        userId: session.userId,
        shortcode: parsed.shortcode,
        url: parsed.canonicalUrl,
        syncStatus: 'pending',
      })
      .returning({ id: reels.id, shortcode: reels.shortcode })

    const run = await startRun([parsed.canonicalUrl])

    await db.insert(syncRuns).values({
      reelId: reel.id,
      apifyRunId: run.runId,
      status: run.status === 'FAILED' ? 'failed' : 'running',
    })

    return ok({ id: reel.id, shortcode: reel.shortcode, syncStatus: 'pending' }, 202)
  } catch (error) {
    return handleError(error)
  }
}
```

> Порядок важен: **сначала резерв бюджета, потом запуск прогона**. Обратный порядок
> означает, что при исчерпанном лимите кредиты уже потрачены, а мы об этом узнаём
> после.

- [ ] **Шаг 2: Проверить руками**

Поднять `npm run dev`, зарегистрироваться, затем скриптом на Node (не `curl` —
в Windows-консоли кириллица в теле запроса портится, это проверено в срезе 1):

| Что отправляем | Ожидаем |
|---|---|
| ссылку из фикстур | `202` + `id` |
| ту же ссылку второй раз | `409` «Этот рилс уже добавлен» |
| `https://tiktok.com/...` | `400` «Нужна ссылка с instagram.com» |
| пустую строку | `400` «Вставь ссылку на рилс» |
| без куки сессии | `401` |

- [ ] **Шаг 3: Коммит**

```bash
git add src/app/api/reels && git commit -m "feat: accept reel url and start apify run"
```

---

### Задача 7: `GET /api/reels/:id` — карточка и продвижение статуса

Эндпоинт двойного назначения: отдаёт данные и попутно двигает состояние.

**Файлы:**
- Создать: `src/app/api/reels/[id]/route.ts`

**Интерфейсы:**
- Потребляет: `getRun`, `getDatasetItems`, `ingestReel`, `assertOwned`.
- Отдаёт наружу: `GET` → карточка рилса со снапшотами. `DELETE` → удаление.

- [ ] **Шаг 1: Реализовать GET**

`src/app/api/reels/[id]/route.ts`:

```ts
import { asc, desc, eq } from 'drizzle-orm'
import { db, reels, reelSnapshots, syncRuns } from '@/db'
import { handleError, ok } from '@/lib/api/respond'
import { getDatasetItems, getRun } from '@/lib/apify/client'
import { assertOwned } from '@/lib/auth/ownership'
import { requireSession } from '@/lib/auth/require-session'
import { ingestReel } from '@/db/queries/ingest'

export const runtime = 'nodejs'

/**
 * Карточка рилса. Попутно двигает состояние: если рилс ещё в `pending`,
 * проверяет статус прогона в Apify и забирает данные, когда тот завершился.
 *
 * ЖДАТЬ ЗАВЕРШЕНИЯ ЗДЕСЬ НЕЛЬЗЯ — функция обрывается через 10 секунд, а прогон
 * идёт 30–60 (PLAN.md §1). Один вызов = одна проверка. Ждёт фронт, опрашивая
 * этот эндпоинт раз в 2–3 секунды.
 */
async function advanceIfPending(reelId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.reelId, reelId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)

  if (!run?.apifyRunId || run.status !== 'running') return

  let handle
  try {
    handle = await getRun(run.apifyRunId)
  } catch {
    // Apify недоступен — не роняем карточку, просто оставляем в pending
    // до следующего опроса. Рилс подхватит крон из среза 7.
    return
  }

  if (handle.status === 'RUNNING') return

  if (handle.status === 'FAILED' || !handle.datasetId) {
    await db
      .update(syncRuns)
      .set({ status: 'failed', error: 'Прогон Apify завершился ошибкой', finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id))

    await db
      .update(reels)
      .set({
        syncStatus: 'failed',
        syncError: 'Не получилось забрать данные. Нажми «Обновить», чтобы повторить',
      })
      .where(eq(reels.id, reelId))

    return
  }

  const items = await getDatasetItems(handle.datasetId)
  await ingestReel(reelId, items)

  await db
    .update(syncRuns)
    .set({ status: 'succeeded', finishedAt: new Date() })
    .where(eq(syncRuns.id, run.id))
}

export async function GET(_request: Request, { params }: RouteContext<'/api/reels/[id]'>) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db.select().from(reels).where(eq(reels.id, id))
    const reel = assertOwned(found, session)

    if (reel.syncStatus === 'pending') {
      await advanceIfPending(reel.id)
    }

    // Перечитываем: advanceIfPending мог поменять статус и метрики.
    const [fresh] = await db.select().from(reels).where(eq(reels.id, id))

    const snapshots = await db
      .select()
      .from(reelSnapshots)
      .where(eq(reelSnapshots.reelId, id))
      .orderBy(asc(reelSnapshots.capturedAt))

    return ok({ reel: fresh, snapshots })
  } catch (error) {
    return handleError(error)
  }
}
```

> `assertOwned` вызывается **до** любых действий с рилсом. Обратный порядок позволил бы
> чужому пользователю тратить наши кредиты Apify, дёргая продвижение статуса на чужой
> записи, — и узнать о её существовании по времени ответа.

- [ ] **Шаг 2: Реализовать DELETE**

В том же файле:

```ts
export async function DELETE(
  _request: Request,
  { params }: RouteContext<'/api/reels/[id]'>,
) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db.select().from(reels).where(eq(reels.id, id))
    assertOwned(found, session)

    // Снапшоты, обложки и прогоны уйдут каскадом: внешние ключи объявлены
    // с ON DELETE CASCADE в схеме.
    await db.delete(reels).where(eq(reels.id, id))

    return ok({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
```

- [ ] **Шаг 3: Проверить изоляцию**

Завести двух пользователей, добавить рилс первому, запросить его вторым.
Ожидаем **404**, не 403 и не 200. Тот же ответ, что на несуществующий `id`.

- [ ] **Шаг 4: Коммит**

```bash
git add src/app/api/reels && git commit -m "feat: reel card endpoint advancing sync state"
```

---

### Задача 8: `GET /api/reels` — список

**Файлы:**
- Модифицировать: `src/app/api/reels/route.ts`
- Создать: `src/db/queries/list-reels.sql.ts`

**Интерфейсы:**
- Отдаёт наружу: `GET /api/reels?sort=views|date` → массив рилсов
  с последним снапшотом у каждого.

- [ ] **Шаг 1: Написать запрос сырым SQL**

Витрина навыка из ТЗ («джаваскрипт, **скл**»). Отдельным файлом с комментарием,
`DISTINCT ON` — специфичный для Postgres приём, закрывается одним индексным сканом
по `(reel_id, captured_at DESC)`:

```sql
SELECT DISTINCT ON (r.id)
       r.id, r.shortcode, r.url, r.caption, r.owner_username,
       r.posted_at, r.sync_status, r.last_synced_at,
       s.views, s.likes, s.comments, s.captured_at
FROM reels r
LEFT JOIN reel_snapshots s ON s.reel_id = r.id
WHERE r.user_id = $1
ORDER BY r.id, s.captured_at DESC;
```

Сортировку по `views` или `posted_at` навесить снаружи, обернув это подзапросом:
`DISTINCT ON` требует, чтобы `ORDER BY` начинался с выражения из `DISTINCT ON`,
поэтому сортировать в том же запросе нельзя.

- [ ] **Шаг 2: Подключить к route handler**

`GET` в `src/app/api/reels/route.ts`: `requireSession()`, вызов запроса,
`ok(rows)`. Параметр `sort` валидировать белым списком — в `ORDER BY`
подстановка значения напрямую это SQL-инъекция.

- [ ] **Шаг 3: Проверить**

Добавить два рилса, запросить список — оба на месте, у каждого метрики
из последнего снапшота. Запросить из-под другого пользователя — пусто.

- [ ] **Шаг 4: Коммит**

```bash
git add src/app/api/reels src/db/queries && git commit -m "feat: list own reels with latest metrics"
```

---

### Задача 9: Сверка с живым Apify

Единственная задача, тратящая кредиты. Делать один раз, осознанно.

- [ ] **Шаг 1: Проверить остаток бюджета**

```bash
node --env-file=.env.local -e "import('./src/lib/apify/budget.ts').then(async m => console.log(await m.usage()))"
```

- [ ] **Шаг 2: Переключиться на живой режим**

В `.env.local` выставить `APIFY_MOCK=0` и заполнить `APIFY_TOKEN`.

- [ ] **Шаг 3: Добавить один настоящий рилс**

Через интерфейс или скриптом. Ожидаем: `202`, затем в течение минуты
`sync_status` меняется с `pending` на `ok`, появляется снапшот с реальными числами.

- [ ] **Шаг 4: Сверить с тем, что показывает Instagram**

Открыть тот же рилс в Instagram и сравнить просмотры и лайки. Расхождение
в пределах минут допустимо, кратное — признак того, что берётся не то поле.

- [ ] **Шаг 5: Вернуть режим мока**

`APIFY_MOCK=1` в `.env.local`. **На проде оставить `APIFY_MOCK=0`** — там нужны
живые данные.

- [ ] **Шаг 6: Записать фактический расход**

Добавить в этот файл строку: сколько результатов ушло на сверку.

- [ ] **Шаг 7: Коммит и деплой**

```bash
git add -A && git commit -m "chore: verify ingest against live apify" && git push
```

---

## Готовность среза

- [ ] `npm test` — зелёный, покрыты расписание, бюджет, клиент Apify
- [ ] `npm run build` — проходит
- [ ] `scripts/verify-budget.mjs` — из десяти параллельных резерваций проходит одна
- [ ] `scripts/verify-ingest.mjs` — все пять пунктов, включая «повтор не пишет снапшот»
- [ ] Вставка ссылки на проде создаёт рилс и первый снапшот с реальными данными
- [ ] Повторная вставка той же ссылки даёт `409`
- [ ] Чужой рилс отдаётся как `404`
- [ ] Приватный или удалённый рилс становится `unavailable`, а не висит в `pending`
- [ ] Расход кредитов Apify за срез записан и укладывается в 300 результатов,
      выделенных на разработку в `PLAN.md` §1
