'use client'

import { useEffect, useId, useRef, useState } from 'react'

export type SelectOption<T extends string> = { value: T; label: string }

/**
 * Выпадающий список в стиле сайта — замена нативному `<select>`.
 *
 * ЗАЧЕМ ВООБЩЕ СВОЙ. Раскрытый список `<select>` рисует не страница, а
 * браузер средствами ОС: ни фон, ни подсветку активного пункта, ни шрифт
 * оттуда достать нельзя — CSS до этого слоя не дотягивается вовсе. На тёмной
 * теме это особенно заметно: аккуратная закрытая кнопка раскрывается в
 * системный список с ярко-синей подсветкой, который выглядит чужим. Поэтому
 * «поправить стили» — не вариант, только замена контрола.
 *
 * ЧТО ЗА ЭТО ЗАПЛАЧЕНО. На телефоне нативный `<select>` открывает системный
 * пикер (колесо на iOS, диалог на Android), и он объективно удобнее списка.
 * Размен сделан осознанно: единообразный вид на всех экранах против родного
 * пикера на одном. Если решение когда-нибудь пересмотрят — вернуть `<select>`
 * для узких экранов можно, не трогая вызывающий код: пропы у него те же.
 *
 * ПОЧЕМУ КЛАВИАТУРА НАПИСАНА РУКАМИ. `role="listbox"` объявляет скринридеру
 * список с выбором и тем самым обещает пользователю стрелки, Home/End и Esc.
 * Роль сама по себе ничего из этого не делает — обещание надо исполнять
 * кодом, иначе получается интерфейс, который врёт о своих возможностях
 * именно тем, кто на это объявление полагается. Тот же довод, что у
 * `role="radio"` в `segmented.tsx`.
 *
 * Фокус УХОДИТ В СПИСОК, а активный пункт помечается `aria-activedescendant`.
 * Альтернатива — оставить фокус на кнопке — заставила бы дублировать
 * обработку стрелок в двух местах и разъезжается при закрытии.
 */
export function SelectMenu<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SelectOption<T>[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  // Пункт под «курсором» клавиатуры. При открытии встаёт на выбранный, чтобы
  // стрелка вниз шла от того, что человек видит на кнопке, а не с начала.
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Фокус переезжает в список сразу после открытия: без этого стрелки
  // достались бы кнопке, а `aria-activedescendant` на несфокусированном
  // элементе скринридер не читает.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  // Клик мимо закрывает. Слушаем pointerdown, а не click: click приходит уже
  // после того, как браузер увёл фокус, и порядок событий начинает зависеть
  // от того, попали в интерактивный элемент или в пустое место.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const openMenu = (index: number) => {
    setActiveIndex(index)
    setOpen(true)
  }

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const choose = (index: number) => {
    onChange(options[index].value)
    close(true)
  }

  const onButtonKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu(selectedIndex)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(options.length - 1)
    }
  }

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + options.length) % options.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(activeIndex)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      // Уход по Tab закрывает список, но фокус НЕ отбираем: человек уже
      // сказал, куда хочет, — вернуть его на кнопку значило бы спорить.
      close(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close(false) : openMenu(selectedIndex))}
        onKeyDown={onButtonKeyDown}
        className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none hover:border-[var(--accent)] focus-visible:border-[var(--accent)]"
      >
        {options[selectedIndex]?.label}
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`h-3 w-3 shrink-0 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-option-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          // Привязка к ПРАВОМУ краю кнопки, а не к левому. Ширина кнопки
          // зависит от длины выбранной подписи, и при короткой («По
          // просмотрам», 149 px) список оказывается шире неё (183 px): с
          // `left-0` он вылезал за колонку контента на 18 px — замерено на
          // узком экране, глазами при длинной подписи этого не видно вовсе.
          // Контрол стоит в конце строки управления на всех ширинах (поиск
          // перед ним растягивается через `flex-1`), поэтому расти влево ему
          // всегда есть куда.
          className="absolute top-full right-0 z-30 mt-1 min-w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow)] outline-none"
        >
          {options.map((option, index) => {
            const selected = index === selectedIndex

            return (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={selected}
                // Наведение мышью двигает и клавиатурный курсор: иначе после
                // движения мышью стрелка вниз прыгала бы от старого места.
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className={`cursor-pointer px-3 py-2 text-sm whitespace-nowrap ${
                  index === activeIndex ? 'bg-[var(--chip)]' : ''
                } ${selected ? 'font-medium text-[var(--ink)]' : 'text-[var(--muted)]'}`}
              >
                {option.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
