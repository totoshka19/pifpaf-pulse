'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Разделы кабинета.
 *
 * Клиентский компонент ТОЛЬКО ради подсветки активного пункта. Сам layout
 * остаётся серверным: он читает пользователя из базы, и утаскивать это
 * на клиент было бы платой ни за что.
 *
 * Путь читается через `usePathname()`, а не в layout: layout не
 * перерисовывается при переходах внутри своего сегмента, и подсветка
 * залипла бы на том разделе, с которого началась сессия.
 */

const LINKS = [
  { href: '/app', label: 'Дашборд' },
  { href: '/app/reels', label: 'Лента' },
  { href: '/app/settings', label: 'Настройки' },
] as const

/**
 * `/app` — префикс всех остальных разделов, поэтому для него сравнение
 * строгое. Иначе «Дашборд» горел бы одновременно с «Лентой».
 */
function isActive(pathname: string, href: string): boolean {
  return href === '/app' ? pathname === '/app' : pathname.startsWith(href)
}

export function AppNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Разделы кабинета" className={className}>
      <ul className="flex items-center gap-1">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href)

          return (
            <li key={link.href}>
              <Link
                href={link.href}
                // aria-current — единственное, что сообщает о выборе
                // скринридеру: цвет он не читает.
                aria-current={active ? 'page' : undefined}
                className={`block rounded-full px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-black/5 hover:text-[var(--ink)]'
                }`}
              >
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
