import { describe, expect, it } from 'vitest'
import { NO_DATA } from './number'
import { formatDayMsk, formatExactMsk, formatIsoDayShort, formatRelative } from './date'

/** 24 августа 2026, 16:30 UTC = 19:30 по Москве. */
const AUG = new Date('2026-08-24T16:30:00Z')

describe('formatExactMsk — точная дата для тултипа', () => {
  it('сдвигает UTC на московские +3', () => {
    expect(formatExactMsk(AUG)).toBe('24 августа 2026, 19:30')
  })

  it('пояс реально применяется, а не берётся из машины', () => {
    // Мутационная страховка: на компьютере в Москве отсутствие пояса
    // прошло бы незаметно. Здесь оно обязано дать другой результат.
    expect(formatExactMsk(AUG, 'UTC')).toBe('24 августа 2026, 16:30')
  })

  it('полночь показывается как 00:00, а не 24:00', () => {
    // Ловушка ICU: hour12:false в локали en-US исторически даёт «24».
    // 21:00 UTC 15 января = 00:00 16 января по Москве.
    expect(formatExactMsk(new Date('2026-01-15T21:00:00Z'))).toBe(
      '16 января 2026, 00:00',
    )
  })

  it('у Москвы нет летнего времени с 2014 года', () => {
    // Январь и август обязаны дать одинаковый сдвиг +3.
    expect(formatExactMsk(new Date('2026-01-15T09:00:00Z'))).toBe(
      '15 января 2026, 12:00',
    )
    expect(formatExactMsk(new Date('2026-07-15T09:00:00Z'))).toBe(
      '15 июля 2026, 12:00',
    )
  })

  it('нет даты — прочерк', () => {
    expect(formatExactMsk(null)).toBe(NO_DATA)
    expect(formatExactMsk(new Date('мусор'))).toBe(NO_DATA)
  })
})

describe('formatDayMsk — короткая дата для таблицы', () => {
  it('день и сокращённый месяц', () => {
    expect(formatDayMsk(AUG)).toBe('24 авг')
  })

  it('нет даты — прочерк', () => {
    expect(formatDayMsk(null)).toBe(NO_DATA)
  })
})

describe('formatRelative — «сколько назад»', () => {
  const now = new Date('2026-08-24T16:30:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('меньше минуты — «только что»', () => {
    expect(formatRelative(ago(5_000), now)).toBe('только что')
  })

  it('минуты склоняются', () => {
    expect(formatRelative(ago(MINUTE), now)).toBe('1 минуту назад')
    expect(formatRelative(ago(3 * MINUTE), now)).toBe('3 минуты назад')
    expect(formatRelative(ago(11 * MINUTE), now)).toBe('11 минут назад')
  })

  it('часы склоняются', () => {
    expect(formatRelative(ago(HOUR), now)).toBe('1 час назад')
    expect(formatRelative(ago(2 * HOUR), now)).toBe('2 часа назад')
    expect(formatRelative(ago(5 * HOUR), now)).toBe('5 часов назад')
  })

  it('до суток считает в часах, даже если полночь уже прошла', () => {
    // 23 часа назад — это «23 часа назад», а не «вчера»: так точнее.
    expect(formatRelative(ago(23 * HOUR), now)).toBe('23 часа назад')
  })

  it('вчера — это вчера', () => {
    expect(formatRelative(ago(26 * HOUR), now)).toBe('вчера')
  })

  it('дни, недели и месяцы', () => {
    expect(formatRelative(ago(3 * DAY), now)).toBe('3 дня назад')
    expect(formatRelative(ago(10 * DAY), now)).toBe('1 неделю назад')
    expect(formatRelative(ago(20 * DAY), now)).toBe('2 недели назад')
    expect(formatRelative(ago(70 * DAY), now)).toBe('2 месяца назад')
  })

  it('дата из будущего не даёт «через сколько-то»', () => {
    // Часы на телефоне блогера могут спешить — это не повод писать чушь.
    expect(formatRelative(new Date(now.getTime() + HOUR), now)).toBe('только что')
  })

  it('нет даты — прочерк', () => {
    expect(formatRelative(null, now)).toBe(NO_DATA)
  })
})

describe('formatIsoDayShort', () => {
  it('превращает московский день из запроса в короткую подпись', () => {
    expect(formatIsoDayShort('2026-08-24')).toBe('24 авг')
  })

  it('срезает ведущий ноль в числе', () => {
    expect(formatIsoDayShort('2026-01-01')).toBe('1 янв')
  })

  it('не уезжает на сутки назад на первом января', () => {
    // Через `new Date('2026-01-01')` это была бы полночь UTC, и любой пояс
    // западнее Гринвича показал бы 31 декабря.
    expect(formatIsoDayShort('2026-01-01')).not.toBe('31 дек')
  })

  it('мусор и пустая строка — прочерк, а не «Invalid Date»', () => {
    expect(formatIsoDayShort('')).toBe(NO_DATA)
    expect(formatIsoDayShort(null)).toBe(NO_DATA)
    expect(formatIsoDayShort('24.08.2026')).toBe(NO_DATA)
    expect(formatIsoDayShort('2026-13-01')).toBe(NO_DATA)
  })
})
