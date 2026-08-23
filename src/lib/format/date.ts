import { MOSCOW_TZ } from '@/lib/time/moscow'
import { NO_DATA } from './number'
import { plural } from './plural'

/**
 * Даты для интерфейса — всегда в московском времени.
 *
 * Названия месяцев берём свои, а не из `Intl.DateTimeFormat('ru-RU')`: тот
 * добавляет «г.» после года («24 августа 2026 г., 19:30»), и вырезать его
 * строковой заменой — значит зависеть от версии ICU. У Intl забираем только
 * числовые поля календаря, где разночтений быть не может.
 */

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
] as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

/**
 * Календарные поля даты в заданном поясе.
 *
 * Читаем `formatToParts` ПО ТИПАМ частей, а не разбираем готовую строку:
 * порядок и разделители зависят от локали, а типы — нет.
 *
 * `hourCycle: 'h23'`, а не `hour12: false`: последний в локали en-US
 * исторически отдавал «24» для полуночи, и дата уезжала на сутки. На текущей
 * сборке Node/ICU это уже не воспроизводится — проверено мутацией 2026-08-24.
 * `h23` оставлен осознанно: он явный и не зависит от того, как конкретная
 * сборка ICU трактует `hour12`.
 */
function partsIn(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

function isUsable(date: Date | null): date is Date {
  return date instanceof Date && !Number.isNaN(date.getTime())
}

const pad = (value: number) => value.toString().padStart(2, '0')

/** «24 августа 2026, 19:30». */
export function formatExactMsk(date: Date | null, timeZone = MOSCOW_TZ): string {
  if (!isUsable(date)) return NO_DATA

  const p = partsIn(date, timeZone)
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`
}

/** «24 авг» — для плотной таблицы, где длинная дата не помещается. */
export function formatDayMsk(date: Date | null, timeZone = MOSCOW_TZ): string {
  if (!isUsable(date)) return NO_DATA

  const p = partsIn(date, timeZone)
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}`
}

/**
 * Номер календарного дня в поясе.
 *
 * Нужен, чтобы «вчера» означало вчерашний календарный день, а не «24 часа
 * назад»: в 00:30 рилс, выложенный вчера в 23:00, — именно вчерашний.
 */
function dayNumber(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone)
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY)
}

/** «только что», «3 часа назад», «вчера», «2 недели назад». */
export function formatRelative(
  date: Date | null,
  now: Date,
  timeZone = MOSCOW_TZ,
): string {
  if (!isUsable(date)) return NO_DATA

  const passed = now.getTime() - date.getTime()

  // Отрицательная разница — часы на устройстве спешат. «Через час» в ленте
  // выглядит как поломка, «только что» — как норма.
  if (passed < MINUTE) return 'только что'

  if (passed < HOUR) {
    const n = Math.floor(passed / MINUTE)
    return `${n} ${plural(n, ['минуту', 'минуты', 'минут'])} назад`
  }

  // До суток считаем в часах независимо от календаря: «23 часа назад»
  // информативнее, чем «вчера».
  if (passed < DAY) {
    const n = Math.floor(passed / HOUR)
    return `${n} ${plural(n, ['час', 'часа', 'часов'])} назад`
  }

  const days = dayNumber(now, timeZone) - dayNumber(date, timeZone)

  if (days <= 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`

  if (days < 30) {
    const n = Math.floor(days / 7)
    return `${n} ${plural(n, ['неделю', 'недели', 'недель'])} назад`
  }

  const n = Math.floor(days / 30)
  return `${n} ${plural(n, ['месяц', 'месяца', 'месяцев'])} назад`
}
