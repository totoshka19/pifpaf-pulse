import { describe, expect, it } from 'vitest'
import { normalizeInstagramHandle, validateDisplayName } from './validate'

/**
 * Проверка полей личного кабинета.
 *
 * Хендл нормализуется, а не принимается как есть: блогер скопирует его из
 * шапки профиля вместе с собачкой, или вставит ссылку целиком, или ссылку
 * с хвостом `?igsh=` от кнопки «Поделиться». Ровно те же формы уже разобраны
 * для ссылок на рилсы в `normalize-url.ts`, и голос ошибок берётся оттуда же.
 */

describe('normalizeInstagramHandle — формы, в которых его вставят', () => {
  it('принимает чистое имя', () => {
    expect(normalizeInstagramHandle('pifpafai')).toEqual({ ok: true, handle: 'pifpafai' })
  })

  it('снимает собачку', () => {
    expect(normalizeInstagramHandle('@pifpafai')).toEqual({ ok: true, handle: 'pifpafai' })
  })

  it('вытаскивает имя из полной ссылки', () => {
    expect(normalizeInstagramHandle('https://www.instagram.com/pifpafai/')).toEqual({
      ok: true,
      handle: 'pifpafai',
    })
  })

  it('отбрасывает хвост от кнопки «Поделиться»', () => {
    expect(normalizeInstagramHandle('instagram.com/pifpafai?igsh=abc')).toEqual({
      ok: true,
      handle: 'pifpafai',
    })
  })

  it('обрезает пробелы и приводит к нижнему регистру', () => {
    // @Anya и @anya — один и тот же человек, а не два разных хендла.
    expect(normalizeInstagramHandle('  @PifPafAI  ')).toEqual({ ok: true, handle: 'pifpafai' })
  })

  it('принимает точки и подчёркивания', () => {
    expect(normalizeInstagramHandle('anya_pif.ai')).toEqual({ ok: true, handle: 'anya_pif.ai' })
  })
})

describe('normalizeInstagramHandle — пустое поле это не ошибка', () => {
  it('пустая строка даёт null, а не отказ', () => {
    // Поле необязательное. Правило «нет данных — не ошибка» действует и здесь.
    expect(normalizeInstagramHandle('')).toEqual({ ok: true, handle: null })
  })

  it('строка из пробелов тоже даёт null', () => {
    expect(normalizeInstagramHandle('   ')).toEqual({ ok: true, handle: null })
  })

  it('одна собачка без имени — тоже пусто', () => {
    expect(normalizeInstagramHandle('@')).toEqual({ ok: true, handle: null })
  })
})

describe('normalizeInstagramHandle — отказы', () => {
  it('отвергает пробел внутри', () => {
    const result = normalizeInstagramHandle('с пробелом')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/[а-яё]/i)
  })

  it('отвергает слишком длинный хендл', () => {
    const result = normalizeInstagramHandle('a'.repeat(31))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/30|длин/i)
  })

  it('ровно тридцать символов ещё принимает', () => {
    expect(normalizeInstagramHandle('a'.repeat(30))).toEqual({
      ok: true,
      handle: 'a'.repeat(30),
    })
  })

  it('отвергает чужую соцсеть и называет нужную', () => {
    const result = normalizeInstagramHandle('https://tiktok.com/@name')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/instagram/i)
  })

  it('отвергает ссылку на рилс: это не хендл', () => {
    const result = normalizeInstagramHandle('https://instagram.com/reel/DcXVbOOiyhL/')

    expect(result.ok).toBe(false)
  })
})

describe('validateDisplayName', () => {
  it('обычное имя проходит', () => {
    expect(validateDisplayName('Аня')).toBeNull()
  })

  it('пробелы по краям не делают имя пустым', () => {
    expect(validateDisplayName('  Аня  ')).toBeNull()
  })

  it('пустое имя не проходит', () => {
    expect(validateDisplayName('')).not.toBeNull()
    expect(validateDisplayName('   ')).not.toBeNull()
  })

  it('слишком длинное имя не проходит', () => {
    expect(validateDisplayName('я'.repeat(61))).not.toBeNull()
  })

  it('ровно шестьдесят символов ещё проходит', () => {
    expect(validateDisplayName('я'.repeat(60))).toBeNull()
  })

  it('текст ошибки человеческий, без кодов', () => {
    const error = validateDisplayName('')

    expect(error).toMatch(/[а-яё]/i)
    expect(error).not.toMatch(/\b\d{3}\b/)
  })
})
