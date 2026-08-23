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

    // Проверяем не поле, а сам буфер: заголовок WebP это RIFF....WEBP.
    expect(result!.data.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(result!.data.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('ужимает по ширине до 480, сохраняя пропорции 9:16', async () => {
    const result = await processThumbnail(await makeJpeg(1215, 2160))

    expect(result!.width).toBe(THUMBNAIL_WIDTH)
    // 2160 / 1215 * 480 = 853.3 → 853
    expect(result!.height).toBe(853)
  })

  it('обрабатывает и другие исходные размеры', async () => {
    // Замеренные на живых обложках: 1179×2096 и 720×1280.
    for (const [w, h] of [
      [1179, 2096],
      [720, 1280],
    ]) {
      const result = await processThumbnail(await makeJpeg(w, h))
      expect(result!.width).toBe(THUMBNAIL_WIDTH)
      expect(result!.height).toBe(Math.round((h / w) * THUMBNAIL_WIDTH))
    }
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

  it('укладывается в лимит CHECK-ограничения на bytes', async () => {
    // bytes в схеме — integer. Обложка обязана быть далеко от переполнения.
    const result = await processThumbnail(await makeJpeg(1215, 2160))
    expect(result!.bytes).toBeGreaterThan(0)
    expect(result!.bytes).toBeLessThan(2_000_000)
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

  it('на обрезанный JPEG отдаёт null', async () => {
    // Соединение оборвалось на середине скачивания.
    const full = await makeJpeg(720, 1280)
    expect(await processThumbnail(full.subarray(0, 40))).toBeNull()
  })
})
