/**
 * Аватар из инициала.
 *
 * Настоящей загрузки файла НЕТ, и это решение, а не недоделка. Схема держит
 * `avatar_url` как TEXT, поэтому загрузка потребовала бы первой миграции
 * с среза 1, маршрута приёма файла, маршрута отдачи и валидации чужого
 * содержимого. Круг с буквой стоит ноль инфраструктуры и говорит на том же
 * языке, что плейсхолдер обложки в `reel-cover.tsx`: буква на мягком
 * градиенте. Загрузка записана в хвосты — срез 8, если останется время.
 *
 * Серверный компонент: никакого состояния здесь нет.
 */

/**
 * Палитра под фон проекта. Все пары — светлые: буква рисуется тёмной,
 * и контраст держится без подбора цвета текста под каждый фон.
 */
const PALETTE = [
  ['#c7d7ff', '#eef4ff'],
  ['#ffd9e0', '#fff0f3'],
  ['#c9f0dd', '#eefaf4'],
  ['#ffe7c2', '#fff7ea'],
  ['#e0d4ff', '#f5f0ff'],
  ['#c2ecf5', '#ebfaff'],
] as const

/**
 * Детерминированный выбор цвета по имени.
 *
 * Именно детерминированный, а не случайный: цвет, прыгающий между
 * загрузками, читается как мигание, а не как оформление. Хеш простой
 * (djb2-подобный) — криптостойкость тут не нужна, нужна стабильность.
 */
function paletteFor(name: string): readonly [string, string] {
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i)
  }

  return PALETTE[Math.abs(hash) % PALETTE.length]
}

export function Avatar({
  name,
  size = 40,
  className = '',
}: {
  name: string
  size?: number
  className?: string
}) {
  const trimmed = name.trim()
  const letter = trimmed.charAt(0).toUpperCase() || '?'
  const [from, to] = paletteFor(trimmed.toLowerCase())

  return (
    <div
      // role="img" с полным именем: одна буква, прочитанная скринридером
      // вслух, не значит ничего.
      role="img"
      aria-label={trimmed ? `Аватар: ${trimmed}` : 'Аватар'}
      className={`flex shrink-0 items-center justify-center rounded-full select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {/*
        Цвет буквы ПРИБИТ, а не взят из `--ink`, и это тот же случай, что
        текст поверх обложки: фон здесь не зависит от темы. PALETTE выше вся
        светлая по замыслу — буква обязана оставаться тёмной и в тёмной теме
        тоже. Через `--ink` она в тёмной становилась светлой и исчезала на
        светлом градиенте: аватар выглядел пустым кружком. Найдено глазами,
        сборка и линт на это молчат.
      */}
      <span aria-hidden className="font-semibold text-[#0f172a]/55">
        {letter}
      </span>
    </div>
  )
}
