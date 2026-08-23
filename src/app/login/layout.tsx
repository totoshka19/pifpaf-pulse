import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/require-session'

// Страница входа помечена 'use client', а клиентские компоненты не могут
// экспортировать metadata — поэтому заголовок задаётся отдельным layout.
export const metadata: Metadata = {
  title: 'Вход',
}

export default async function LoginLayout({ children }: LayoutProps<'/login'>) {
  // Уже вошедшему форма входа не нужна. Проверка живёт здесь, а не на главной:
  // лендинг должен оставаться статикой, а /login открывают заметно реже.
  if (await getSession()) redirect('/app')

  return children
}
