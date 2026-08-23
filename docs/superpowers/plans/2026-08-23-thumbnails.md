# PifPaf Pulse — срез 4: обложки

> **Для исполнителя:** используй `superpowers:subagent-driven-development` (рекомендуется)
> или `superpowers:executing-plans`. Шаги размечены чекбоксами (`- [ ]`).

**Цель:** обложки рилсов хранятся у нас и отдаются с нашего домена. Ссылки Instagram
протухают за ~4,5 суток — без этого среза у продукта встроенный таймер: тестовое
посмотрят на пятый день и увидят сетку серых квадратов вместо обложек.

**Архитектура:** скачивание обложки **вынесено из `ingestReel`** в отдельную функцию
`ensureThumbnail(reelId)`. Причина в замерах: скачивание занимает 0,5–1,8 с, и внутри
батча из среза 7 двадцать обложек не влезут в десятисекундный лимит функции. Вызов
идёт из карточки (один рилс), из крона (с ограничением по количеству) и из скрипта
дозаливки. Ошибка скачивания **никогда** не роняет приём метрик: просмотры важнее
картинки.

**Тех.стек:** `sharp` 0.35.3 (libvips 8.18.3), `bytea` в Postgres, route handler
с иммутабельным кешем.

**Спека:** [`PLAN.md`](../../../PLAN.md) §6 (ловушка с обложками), §8 (`reel_thumbnails`).

**Предыдущий срез:** [`2026-08-23-core-ingest.md`](2026-08-23-core-ingest.md) — закрыт.

## Замеры, на которых стоит план

Всё измерено на трёх настоящих обложках из `fixtures/apify/`, не взято из головы.

| Что | Значение |
|---|---|
| Срок жизни ссылки Instagram | **≈106 часов** (параметр `oe` в query) |
| Скачивание обложки серверным `fetch` | **HTTP 200 без特 заголовков**, 0,5–1,8 с |
| Размер оригинала | 162–338 КБ, портрет до 1215×2160 |
| После `resize(480) + webp(80)` | **43–70 КБ**, 480×853 |
| Коэффициент сжатия | **5,1×** (817 КБ → 159 КБ на трёх) |
| Время обработки `sharp` | 50–73 мс |
| Прогноз на ленту из 20 рилсов | **1 МБ вместо 5,3 МБ** |
| Хранение 60 обложек | ≈3,2 МБ при лимите Neon 0,5 ГБ |

> Хотлинк Instagram блокирует по заголовку `Referer`, который браузер шлёт, а серверный
> `fetch` — нет. Поэтому обходных манёвров с `User-Agent` не потребовалось.

## Глобальные ограничения

- **10 секунд на функцию** (Netlify free). Скачивание — 0,5–1,8 с на картинку,
  значит в батче их число обязано быть ограничено.
- **Ошибка обложки не роняет ingest.** `sync_status` остаётся `ok`, если метрики
  пришли, даже когда картинку скачать не удалось.
- Изоляция данных: отдача обложки проверяет сессию и владение.
- ORM — Drizzle, запросы в `src/db/queries/`.
- Тексты — по-русски, на «ты».

## Что сознательно НЕ входит

| Что | Куда | Почему |
|---|---|---|
| Вызов `ensureThumbnail` из крона | срез 7 | крона ещё нет; интерфейс задан здесь |
| Вёрстка ленты | срез 5 | здесь только компонент `<ReelCover>` и его поведение |
| `next/image` | не используем | картинка уже нормализована нами: один размер, один формат. Слой оптимизации поверх этого — лишняя обработка и лишняя зависимость от площадки |

---

### Задача 1: Обработка изображения

Чистая функция над буфером — тестируется без сети.

**Файлы:**
- Создать: `src/lib/images/process.ts`
- Тест: `src/lib/images/process.test.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  type ProcessedImage = {
    data: Buffer
    mime: 'image/webp'
    width: number
    height: number
    bytes: number
  }
  const THUMBNAIL_WIDTH: 480
  async function processThumbnail(input: Buffer): Promise<ProcessedImage | null>
  ```
  `null` — вход не является картинкой. Используется задачей 3.

- [ ] **Шаг 1: Написать падающие тесты**

`src/lib/images/process.test.ts`:

```ts
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { processThumbnail, THUMBNAIL_WIDTH } from './process'

/** Генерируем картинку на месте: тест не должен зависеть от сети. */
const makeJpeg = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer()

describe('processThumbnail — приведение к единому формату', () => {
  it('превращает JPEG в WebP', async () => {
    const result = await processThumbnail(await makeJpeg(1215, 2160))

    expect(result).not.toBeNull()
    expect(result!.mime).toBe('image/webp')

    // Проверяем не поле, а сам буфер: заголовок WebP начинается с RIFF....WEBP.
    expect(result!.data.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(result!.data.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('ужимает по ширине до 480, сохраняя пропорции 9:16', async () => {
    const result = await processThumbnail(await makeJpeg(1215, 2160))

    expect(result!.width).toBe(THUMBNAIL_WIDTH)
    // 2160 / 1215 * 480 = 853.3 → 853
    expect(result!.height).toBe(853)
  })

  it('маленькую картинку НЕ растягивает', async () => {
    // withoutEnlargement: апскейл только раздул бы файл, не добавив деталей.
    const result = await processThumbnail(await makeJpeg(200, 356))

    expect(result!.width).toBe(200)
    expect(result!.height).toBe(356)
  })

  it('bytes совпадает с длиной буфера', async () => {
    const result = await processThumbnail(await makeJpeg(720, 1280))
    expect(result!.bytes).toBe(result!.data.length)
  })

  it('результат заметно меньше оригинала', async () => {
    const input = await makeJpeg(1215, 2160)
    const result = await processThumbnail(input)
    expect(result!.bytes).toBeLessThan(input.length)
  })
})

describe('processThumbnail — мусор на входе', () => {
  it('на не-картинку отдаёт null, а не бросает', async () => {
    expect(await processThumbnail(Buffer.from('это не картинка'))).toBeNull()
  })

  it('на пустой буфер отдаёт null', async () => {
    expect(await processThumbnail(Buffer.alloc(0))).toBeNull()
  })

  it('на HTML-страницу ошибки отдаёт null', async () => {
    // Реальный случай: CDN вернул 200 со страницей заглушки вместо картинки.
    expect(await processThumbnail(Buffer.from('<html><body>404</body></html>'))).toBeNull()
  })
})
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

Запустить: `npm test -- images/process`
Ожидаем: FAIL, `Cannot find module './process'`.

- [ ] **Шаг 3: Реализовать**

`src/lib/images/process.ts`:

```ts
import sharp from 'sharp'

export type ProcessedImage = {
  data: Buffer
  mime: 'image/webp'
  width: number
  height: number
  bytes: number
}

/**
 * 480 px по ширине. Рилсы вертикальные 9:16, в сетке карточка занимает
 * 180–300 px; с учётом плотных экранов 480 покрывает с запасом, а дальше
 * растёт только вес.
 */
export const THUMBNAIL_WIDTH = 480

/** Замерено на настоящих обложках: 43–70 КБ при 5,1× сжатия. */
const WEBP_QUALITY = 80

export async function processThumbnail(input: Buffer): Promise<ProcessedImage | null> {
  try {
    const { data, info } = await sharp(input)
      .resize({
        width: THUMBNAIL_WIDTH,
        // Апскейл только раздул бы файл, не добавив деталей.
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true })

    return {
      data,
      mime: 'image/webp',
      width: info.width,
      height: info.height,
      bytes: data.length,
    }
  } catch {
    // Не картинка. Бывает штатно: CDN отдаёт 200 со страницей-заглушкой.
    return null
  }
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запустить: `npm test -- images/process`
Ожидаем: `8 passed`.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/images && git commit -m "feat: normalize thumbnails to webp 480px"
```

---

### Задача 2: Скачивание с защитой от сюрпризов

**Файлы:**
- Создать: `src/lib/images/fetch.ts`
- Тест: `src/lib/images/fetch.test.ts`

**Интерфейсы:**
- Отдаёт наружу:
  ```ts
  async function fetchImage(url: string): Promise<Buffer | null>
  ```
  `null` на любую неудачу. Используется задачей 3.

- [ ] **Шаг 1: Написать падающие тесты**

Тесты подменяют `globalThis.fetch` — сеть в юнит-тестах не трогаем:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchImage, MAX_IMAGE_BYTES } from './fetch'

const respond = (body: BodyInit, init?: ResponseInit) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init))

afterEach(() => vi.restoreAllMocks())

describe('fetchImage', () => {
  it('возвращает буфер на успешный ответ с картинкой', async () => {
    respond(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
    const result = await fetchImage('https://example.com/a.jpg')
    expect(result).toBeInstanceOf(Buffer)
    expect(result!.length).toBe(3)
  })

  it('на 404 отдаёт null', async () => {
    respond('', { status: 404 })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает не-картинку по content-type', async () => {
    // Протухшая ссылка отдаёт HTML со страницей ошибки, иногда с кодом 200.
    respond('<html>error</html>', { headers: { 'content-type': 'text/html' } })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает слишком большой файл по заголовку', async () => {
    respond('', {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_IMAGE_BYTES + 1) },
    })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает слишком большой файл, даже если заголовок соврал', async () => {
    // Content-Length можно не прислать или прислать неверный. Проверяем факт.
    respond(new Uint8Array(MAX_IMAGE_BYTES + 10), { headers: { 'content-type': 'image/jpeg' } })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('на сетевую ошибку отдаёт null, а не бросает', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает не-http схемы', async () => {
    // Защита от подстановки file:// или data: в thumbnailSrc.
    expect(await fetchImage('file:///etc/passwd')).toBeNull()
    expect(await fetchImage('data:image/png;base64,AAA')).toBeNull()
  })

  it('пустую строку не пытается скачать', async () => {
    expect(await fetchImage('')).toBeNull()
  })
})
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

- [ ] **Шаг 3: Реализовать**

```ts
/** Замерено: оригиналы 162–338 КБ. 8 МБ — потолок с большим запасом. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Скачивание идёт внутри запроса с лимитом 10 с — оставляем себе запас. */
const TIMEOUT_MS = 8000

export async function fetchImage(url: string): Promise<Buffer | null> {
  if (!url) return null

  // Только http(s): thumbnailSrc приходит из внешнего API, и file:// или data:
  // в нём — это чтение локальных файлов чужими руками.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    })

    if (!response.ok) return null

    const type = response.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return null

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null

    const buffer = Buffer.from(await response.arrayBuffer())

    // Заголовка могло не быть или он мог соврать — проверяем факт.
    return buffer.length > MAX_IMAGE_BYTES ? null : buffer
  } catch {
    return null
  }
}
```

- [ ] **Шаг 4: Тесты зелёные** — `npm test -- images/fetch`, ожидаем `8 passed`

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/images && git commit -m "feat: guarded image download"
```

---

### Задача 3: Хранение и `ensureThumbnail`

**Файлы:**
- Создать: `src/db/queries/thumbnails.ts`
- Тест: `src/db/queries/thumbnails.integration.test.ts`

**Интерфейсы:**
- Потребляет: `fetchImage` (задача 2), `processThumbnail` (задача 1).
- Отдаёт наружу:
  ```ts
  async function ensureThumbnail(reelId: string): Promise<'stored' | 'exists' | 'skipped'>
  async function readThumbnail(reelId: string): Promise<{ data: Buffer; mime: string } | null>
  ```
  `ensureThumbnail` идемпотентна: повторный вызов не перекачивает.
  Используется задачами 4, 5 и срезом 7.

- [ ] **Шаг 1: Реализовать**

```ts
import { eq } from 'drizzle-orm'
import { db, reels, reelThumbnails } from '@/db'
import { fetchImage } from '@/lib/images/fetch'
import { processThumbnail } from '@/lib/images/process'

/**
 * Скачивает обложку рилса и кладёт к себе.
 *
 * Вынесено ИЗ `ingestReel` намеренно: скачивание занимает 0,5–1,8 с (замерено),
 * и внутри батча из среза 7 двадцать обложек не влезут в 10-секундный лимит
 * функции. Вызывающий сам решает, сколько картинок себе позволить.
 *
 * Никогда не бросает: метрики важнее картинки, и провал скачивания не должен
 * ронять приём данных.
 */
export async function ensureThumbnail(reelId: string) {
  const [existing] = await db
    .select({ reelId: reelThumbnails.reelId })
    .from(reelThumbnails)
    .where(eq(reelThumbnails.reelId, reelId))

  if (existing) return 'exists' as const

  const [reel] = await db
    .select({ src: reels.thumbnailSrc })
    .from(reels)
    .where(eq(reels.id, reelId))

  if (!reel?.src) return 'skipped' as const

  const raw = await fetchImage(reel.src)
  if (!raw) return 'skipped' as const

  const image = await processThumbnail(raw)
  if (!image) return 'skipped' as const

  await db
    .insert(reelThumbnails)
    .values({
      reelId,
      data: image.data,
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    })
    // Гонка двух параллельных вызовов — не ошибка: кто успел, того и картинка.
    .onConflictDoNothing()

  return 'stored' as const
}

export async function readThumbnail(reelId: string) {
  const [row] = await db
    .select({ data: reelThumbnails.data, mime: reelThumbnails.mime })
    .from(reelThumbnails)
    .where(eq(reelThumbnails.reelId, reelId))

  return row ?? null
}
```

- [ ] **Шаг 2: Написать интеграционный тест**

`src/db/queries/thumbnails.integration.test.ts` — на живой базе, по образцу
`ingest.integration.test.ts`. Случаи:

1. рилс с настоящим `thumbnailSrc` из фикстур → `'stored'`, в базе появилась
   строка, `bytes` соответствует длине `data`, `mime = 'image/webp'`;
2. повторный вызов → `'exists'`, строка не продублировалась;
3. рилс без `thumbnailSrc` → `'skipped'`, строки нет;
4. рилс с заведомо мёртвой ссылкой → `'skipped'`, **исключения нет**;
5. `readThumbnail` отдаёт то, что положили, байт в байт;
6. удаление рилса уносит обложку каскадом.

> Случай 4 — ключевой. Ссылки Instagram протухают, и к моменту дозаливки часть
> из них будет мертва. Функция обязана это переживать молча.

- [ ] **Шаг 3: Прогнать** — `npm run test:db`

- [ ] **Шаг 4: Коммит**

```bash
git add src/db/queries && git commit -m "feat: store thumbnails in postgres"
```

---

### Задача 4: Отдача обложки

**Файлы:**
- Создать: `src/app/api/thumbnails/[id]/route.ts`

**Интерфейсы:**
- Отдаёт наружу: `GET /api/thumbnails/{reelId}` → `image/webp`.

- [ ] **Шаг 1: Реализовать**

```ts
import { eq } from 'drizzle-orm'
import { db, reels } from '@/db'
import { readThumbnail } from '@/db/queries/thumbnails'
import { handleError } from '@/lib/api/respond'
import { assertOwned } from '@/lib/auth/ownership'
import { requireSession } from '@/lib/auth/require-session'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: RouteContext<'/api/thumbnails/[id]'>) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db
      .select({ id: reels.id, userId: reels.userId })
      .from(reels)
      .where(eq(reels.id, id))

    assertOwned(found, session)

    const thumbnail = await readThumbnail(id)
    if (!thumbnail) {
      // Обложки нет — не ошибка. Компонент покажет плейсхолдер.
      return new Response(null, { status: 404 })
    }

    return new Response(new Uint8Array(thumbnail.data), {
      headers: {
        'content-type': thumbnail.mime,
        // Картинка иммутабельна: она привязана к id рилса и не меняется.
        // private — потому что ответ зависит от сессии, и общий кеш
        // (CDN, корпоративный прокси) не должен отдавать её другим.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    return handleError(error)
  }
}
```

- [ ] **Шаг 2: Подключить к приёму**

В `src/app/api/reels/[id]/route.ts`, после успешного `ingestReel`:

```ts
// Обложка — не критичный путь: метрики уже записаны. Ошибку глотаем,
// на следующем заходе попробуем снова.
await ensureThumbnail(reelId).catch(() => {})
```

- [ ] **Шаг 3: Проверить руками**

Добавить рилс, дождаться `ok`, открыть `/api/thumbnails/{id}` в браузере.
Ожидаем картинку. Затем открыть тот же адрес в инкогнито — ожидаем `401`.

- [ ] **Шаг 4: Коммит**

```bash
git add src/app/api && git commit -m "feat: serve cached thumbnails from our domain"
```

---

### Задача 5: Компонент `<ReelCover>`

**Файлы:**
- Создать: `src/components/reel-cover.tsx`

**Интерфейсы:**
- Отдаёт наружу: `<ReelCover reelId author caption />`.
  Используется срезом 5 (лента) и срезом 6 (карточка).

- [ ] **Шаг 1: Реализовать**

Клиентский компонент. Поведение:

- показывает `/api/thumbnails/{reelId}` в контейнере с пропорцией 9:16;
- при `onError` **и** при отсутствии `reelId` рисует плейсхолдер: мягкий градиент
  и первая буква имени автора крупно;
- пока грузится — фон-заглушка того же размера, чтобы сетка не прыгала.

> **Никогда не показывать сломанную иконку картинки.** Это прямо в чек-листе
> §12 спеки, и это первое, что бросается в глаза при беглом просмотре ленты.

```tsx
'use client'

import { useState } from 'react'

type Props = { reelId: string; author?: string | null; caption?: string | null }

export function ReelCover({ reelId, author, caption }: Props) {
  const [broken, setBroken] = useState(false)
  const letter = (author ?? '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[var(--radius)] bg-[#e2e8f0]">
      {broken ? (
        <div
          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#c7d7ff] to-[#eef4ff]"
          aria-label={author ? `Обложка недоступна, автор ${author}` : 'Обложка недоступна'}
        >
          <span className="text-5xl font-semibold text-[var(--ink)]/40">{letter}</span>
        </div>
      ) : (
        // Обычный img, а не next/image: картинка уже нормализована нами —
        // один размер, один формат. Слой оптимизации поверх этого только
        // добавил бы обработку и привязку к площадке.
        <img
          src={`/api/thumbnails/${reelId}`}
          alt={caption?.slice(0, 80) ?? 'Обложка рилса'}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
    </div>
  )
}
```

- [ ] **Шаг 2: Коммит**

```bash
git add src/components && git commit -m "feat: reel cover with graceful placeholder"
```

---

### Задача 6: Дозаливка обложек для уже добавленных рилсов

**Файлы:**
- Создать: `scripts/backfill-thumbnails.mjs`

- [ ] **Шаг 1: Реализовать**

Скрипт проходит по рилсам со статусом `ok`, у которых нет строки в `reel_thumbnails`,
и вызывает логику скачивания. Ограничения:

- **не более N за прогон** (по умолчанию 20) — чтобы не упереться во время;
- пауза 200 мс между картинками — не долбить CDN очередью;
- в конце печатает: сколько скачано, сколько пропущено, сколько весит итого.

> Скрипт нужен потому, что рилсы, добавленные до этого среза, хранят только
> `thumbnailSrc`. У них осталось ~4,5 суток от момента добавления, дальше ссылки
> умрут — и дозалить будет неоткуда.

- [ ] **Шаг 2: Добавить команду**

`package.json`: `"thumbs:backfill": "node --env-file=.env.local scripts/backfill-thumbnails.mjs"`

- [ ] **Шаг 3: Прогнать и убедиться**

Ожидаем: у всех рилсов со статусом `ok` появились обложки, суммарный вес
соответствует прогнозу (~50 КБ на штуку).

- [ ] **Шаг 4: Коммит**

```bash
git add scripts package.json && git commit -m "chore: backfill thumbnails for existing reels"
```

---

### Задача 7: Проверка на проде

- [ ] **Шаг 1: Убедиться, что сборка на Linux не упала**

`sharp` — нативный модуль, ставится с платформенным бинарником. Установка шла
на Windows, сборка идёт на Linux. В `package-lock.json` (версия 3) записаны
**26 платформенных пакетов**, включая `@img/sharp-linux-x64`, поэтому должно
собраться. **Проверить в логе сборки Netlify**, а не понадеяться.

- [ ] **Шаг 2: Пройти путь на проде**

Добавить рилс → дождаться `ok` → открыть `/api/thumbnails/{id}`.
Ожидаем WebP со своего домена.

- [ ] **Шаг 3: Проверить кеширование**

Открыть обложку дважды, посмотреть в DevTools вкладку Network:
второй раз должно быть `(disk cache)`, без запроса на сервер.

- [ ] **Шаг 4: Убедиться, что вес соответствует замерам**

В DevTools размер ответа ожидаем 43–70 КБ, а не 162–338 КБ.

---

### Задача 8: Поправить спеку по фактическим замерам

- [ ] **Шаг 1: Обновить `PLAN.md` §6**

Заменить оценку «~30–40 КБ» на измеренные **43–70 КБ**; добавить коэффициент
сжатия 5,1× и время обработки 50–73 мс.

- [ ] **Шаг 2: Обновить §1**

Уточнить расход хранилища Neon: 60 обложек ≈ **3,2 МБ** при лимите 0,5 ГБ.

- [ ] **Шаг 3: Коммит**

```bash
git add PLAN.md && git commit -m "docs: replace thumbnail estimates with measurements"
```

---

## Готовность среза

- [ ] `npm test` — зелёный, покрыты обработка и скачивание картинок
- [ ] `npm run test:db` — зелёный, покрыто хранение и идемпотентность
- [ ] `npm run build` — проходит **и локально, и на Netlify** (`sharp` собрался)
- [ ] Обложка отдаётся с нашего домена как `image/webp`
- [ ] Вес обложки в 4–7 раз меньше оригинала
- [ ] Второе открытие берётся из кеша браузера, без запроса
- [ ] Чужая обложка отдаётся как `404`
- [ ] Мёртвая ссылка не роняет приём метрик: `sync_status` остаётся `ok`
- [ ] `<ReelCover>` показывает плейсхолдер вместо сломанной иконки
- [ ] Все ранее добавленные рилсы дозалиты
- [ ] Замеры в `PLAN.md` заменены на фактические
