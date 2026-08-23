import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchImage, MAX_IMAGE_BYTES } from './fetch'

/** Подменяем сеть: юнит-тест не должен ходить в интернет. */
const respond = (body: BodyInit | null, init?: ResponseInit) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init))

const IMAGE = { 'content-type': 'image/jpeg' }

afterEach(() => vi.restoreAllMocks())

describe('fetchImage — обычный путь', () => {
  it('возвращает буфер на успешный ответ с картинкой', async () => {
    respond(new Uint8Array([1, 2, 3]), { headers: IMAGE })

    const result = await fetchImage('https://example.com/a.jpg')

    expect(result).toBeInstanceOf(Buffer)
    expect(result!.length).toBe(3)
    expect([...result!]).toEqual([1, 2, 3])
  })

  it('принимает любой image/*', async () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/jpeg; charset=binary']) {
      respond(new Uint8Array([1]), { headers: { 'content-type': type } })
      expect(await fetchImage('https://example.com/a')).not.toBeNull()
    }
  })
})

describe('fetchImage — плохие ответы', () => {
  it('на 404 отдаёт null', async () => {
    respond('', { status: 404 })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('на 403 отдаёт null', async () => {
    // Протухшая подпись в ссылке Instagram выглядит именно так.
    respond('', { status: 403 })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает не-картинку по content-type', async () => {
    // Реальный случай: CDN отдаёт HTML со страницей ошибки, иногда с кодом 200.
    respond('<html>error</html>', { headers: { 'content-type': 'text/html' } })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает ответ без content-type', async () => {
    respond(new Uint8Array([1]), { headers: {} })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('на сетевую ошибку отдаёт null, а не бросает', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })
})

describe('fetchImage — ограничение размера', () => {
  it('отвергает слишком большой файл по заголовку', async () => {
    respond('', {
      headers: { ...IMAGE, 'content-length': String(MAX_IMAGE_BYTES + 1) },
    })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('отвергает слишком большой файл, даже если заголовок соврал', async () => {
    // Content-Length можно не прислать или прислать неверный — проверяем факт.
    respond(new Uint8Array(MAX_IMAGE_BYTES + 10), { headers: IMAGE })
    expect(await fetchImage('https://example.com/a.jpg')).toBeNull()
  })

  it('пропускает файл ровно на границе', async () => {
    respond(new Uint8Array(MAX_IMAGE_BYTES), { headers: IMAGE })
    expect(await fetchImage('https://example.com/a.jpg')).not.toBeNull()
  })
})

describe('fetchImage — защита от подстановки схемы', () => {
  it('отвергает file:// — иначе это чтение локальных файлов чужими руками', async () => {
    const spy = respond(new Uint8Array([1]), { headers: IMAGE })

    expect(await fetchImage('file:///etc/passwd')).toBeNull()
    // Важно, что до сети вообще не дошло.
    expect(spy).not.toHaveBeenCalled()
  })

  it('отвергает data: и прочие схемы', async () => {
    const spy = respond(new Uint8Array([1]), { headers: IMAGE })

    for (const url of ['data:image/png;base64,AAA', 'ftp://host/a.jpg', 'javascript:alert(1)']) {
      expect(await fetchImage(url)).toBeNull()
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('пустую строку и мусор не пытается скачать', async () => {
    const spy = respond(new Uint8Array([1]), { headers: IMAGE })

    expect(await fetchImage('')).toBeNull()
    expect(await fetchImage('не ссылка')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
