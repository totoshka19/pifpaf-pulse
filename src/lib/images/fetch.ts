/**
 * Скачивание обложки с CDN Instagram.
 *
 * Проверено на трёх настоящих ссылках: обычный серверный `fetch` получает
 * HTTP 200 и `image/jpeg` без каких-либо особых заголовков. Хотлинк Instagram
 * блокирует по `Referer`, который шлёт браузер, а сервер не шлёт.
 *
 * Возвращает `null` на любую неудачу и никогда не бросает: обложка — не
 * критичный путь, метрики важнее картинки.
 */

/** Замерено: оригиналы 162–338 КБ. 8 МБ — потолок с большим запасом. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Скачивание идёт внутри запроса с лимитом 10 с — оставляем себе запас. */
const TIMEOUT_MS = 8000

export async function fetchImage(url: string): Promise<Buffer | null> {
  if (!url) return null

  // Только http(s). `thumbnailSrc` приходит из внешнего API, и file:// в нём
  // означал бы чтение локальных файлов чужими руками. Проверка ДО сети.
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

    // Заголовка могло не быть или он мог соврать — проверяем по факту.
    return buffer.length > MAX_IMAGE_BYTES ? null : buffer
  } catch {
    return null
  }
}
