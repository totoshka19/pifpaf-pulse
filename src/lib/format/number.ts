/**
 * Форматирование чисел для интерфейса.
 *
 * ВРУЧНУЮ, а не через `Intl.NumberFormat({ notation: 'compact' })` — намеренно.
 * Compact-нотация приходит из данных ICU: её вывод зависит от версии Node и от
 * браузера, и «1,2 млн» на сервере может оказаться «1,2 M» в чужой сборке.
 * Сервер и клиент рисуют одну и ту же карточку, поэтому расхождение здесь —
 * ошибка гидрации, а не косметика.
 */

/**
 * Неразрывный: «8 431» не должно рваться переносом строки посреди числа.
 * Escape, а не символ: литеральный U+00A0 неотличим от пробела на глаз,
 * и подмену не поймали бы ни ревью, ни дифф.
 */
const NBSP = '\u00A0'

/** Типографский минус U+2212: он одной ширины с плюсом, дефис — уже. */
const MINUS = '\u2212'

/** Нет данных. Ноль — валидное значение и выглядит иначе (PLAN.md §12). */
export const NO_DATA = '—'

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Одна цифра после запятой, без хвостового нуля: 12.34 → «12,3», 10 → «10». */
function decimal(value: number): string {
  return (Math.round(value * 10) / 10).toString().replace('.', ',')
}

/** 1245903 → «1 245 903». Для тултипа, где нужна точность. */
export function formatExact(value: number | null): string {
  if (!isNumber(value)) return NO_DATA

  const sign = value < 0 ? MINUS : ''
  const digits = Math.abs(Math.trunc(value)).toString()

  // Вставляем разделитель перед каждой группой из трёх цифр справа.
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** 8431 → «8 431», 245000 → «245 тыс.», 1200000 → «1,2 млн». */
export function formatCount(value: number | null): string {
  if (!isNumber(value)) return NO_DATA

  const abs = Math.abs(Math.trunc(value))
  const sign = value < 0 ? MINUS : ''

  // До десяти тысяч блогеру важна каждая цифра, дальше точность — шум.
  if (abs < 10_000) return formatExact(value)

  if (abs < 1_000_000) {
    const thousands = abs / 1000

    // 999 999 дало бы «1000 тыс.» — это должен быть миллион.
    if (Math.round(thousands) >= 1000) return `${sign}1${NBSP}млн`

    const shown = thousands < 100 ? decimal(thousands) : Math.round(thousands)
    return `${sign}${shown}${NBSP}тыс.`
  }

  return `${sign}${decimal(abs / 1_000_000)}${NBSP}млн`
}

/** Прирост со знаком: 12000 → «+12 тыс.», −340 → «−340». */
export function formatDelta(value: number | null): string {
  if (!isNumber(value)) return NO_DATA

  // Отрицательный знак уже проставит formatCount — свой минус не добавляем.
  return value > 0 ? `+${formatCount(value)}` : formatCount(value)
}
