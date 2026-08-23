import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@/lib/auth/ownership'
import { fail, handleError, ok } from './respond'

const body = (response: Response) => response.json()

describe('ok', () => {
  it('по умолчанию отдаёт 200 и тело как есть', async () => {
    const response = ok({ a: 1 })
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ a: 1 })
  })

  it('принимает свой код', () => {
    expect(ok({}, 202).status).toBe(202)
  })
})

describe('fail', () => {
  it('кладёт текст в поле error', async () => {
    const response = fail('Вставь ссылку на рилс', 400)
    expect(response.status).toBe(400)
    expect(await body(response)).toEqual({ error: 'Вставь ссылку на рилс' })
  })
})

describe('handleError — наши ошибки', () => {
  it('NotFoundError превращает в 404 с её текстом', async () => {
    const response = handleError(new NotFoundError())
    expect(response.status).toBe(404)
    expect(await body(response)).toEqual({ error: 'Не найдено' })
  })

  it('подхватывает любую ошибку с числовым status 4xx', async () => {
    // Проверяется КОНТРАКТ, а не класс: хелпер не знает про сессии и владение,
    // и любая будущая ошибка с тем же полем подхватится без его правки.
    const custom = Object.assign(new Error('Слишком часто, подожди минуту'), { status: 429 })

    const response = handleError(custom)
    expect(response.status).toBe(429)
    expect(await body(response)).toEqual({ error: 'Слишком часто, подожди минуту' })
  })
})

describe('handleError — чужие ошибки не протекают наружу', () => {
  it('обычную ошибку превращает в 500 с нейтральным текстом', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const leaky = new Error('connect ECONNREFUSED postgresql://user:ПАРОЛЬ@host/db')
    const response = handleError(leaky)

    expect(response.status).toBe(500)
    const payload = await body(response)
    expect(payload.error).not.toMatch(/postgres|ПАРОЛЬ|ECONNREFUSED/)
    expect(payload.error.length).toBeGreaterThan(0)
  })

  it('status вне диапазона 4xx не принимает на веру', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // 500 от драйвера или 200 из чужой библиотеки не должны стать кодом ответа.
    for (const status of [200, 302, 500, 503]) {
      const response = handleError(Object.assign(new Error('внутреннее'), { status }))
      expect(response.status).toBe(500)
      expect((await body(response)).error).not.toBe('внутреннее')
    }
  })

  it('переживает не-Error значения', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const thrown of [null, undefined, 'строка', 42, {}]) {
      expect(handleError(thrown).status).toBe(500)
    }
  })
})
