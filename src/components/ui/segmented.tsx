'use client'

import { useRef } from 'react'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Полная подпись для скринридера, если короткая звучит вслух как мусор. */
  spoken?: string
}

/**
 * Переключатель из нескольких взаимоисключающих вариантов — «пилюля».
 *
 * Вынесен из `feed-controls.tsx`, где жил в единственном экземпляре для вида
 * ленты. Понадобился второй раз, когда период переехал с нативного `<select>`
 * на тот же контрол: раскрытый список `<select>` рисует ОС, и до него не
 * дотягивается ни один селектор — «сделать красиво» там нечем в принципе.
 *
 * Внешний вид взят от `stats/range-switch.tsx` на дашборде, а не наоборот.
 * Там тот же выбор периода, и до этой правки два экрана показывали одно и то
 * же двумя разными контролами: контейнер `--surface` против `--chip`,
 * активный `--accent-soft` против `--surface`. Теперь совпадают все три.
 *
 * ПРО КЛАВИАТУРУ. `role="radio"` сама по себе меняет только то, что слышит
 * скринридер, — поведения нативного `<input type="radio">` она не даёт.
 * Roving tabIndex и стрелки подключены руками: без них `Tab` останавливался
 * бы на каждой кнопке, а стрелки не делали бы ничего, хотя скринридер уже
 * объявил бы «radio group, 1 of 3» и подготовил пользователя именно к
 * такому вводу. Ровно тот же довод, что и в `select-menu.tsx`.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const select = (index: number) => {
    onChange(options[index].value)
    refs.current[index]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      select((index + 1) % options.length)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      select((index - 1 + options.length) % options.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      select(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      select(options.length - 1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-1 rounded-full bg-[var(--chip)] p-0.5"
    >
      {options.map((option, index) => {
        const active = option.value === value

        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.spoken}
            // Один Tab-стоп на всю группу: внутрь ходят стрелками.
            tabIndex={active ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
              active
                ? 'bg-[var(--surface)] font-medium text-[var(--ink)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
