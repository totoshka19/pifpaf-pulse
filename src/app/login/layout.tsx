import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session-user'

// Страница входа помечена 'use client', а клиентские компоненты не могут
// экспортировать metadata — поэтому заголовок задаётся отдельным layout.
export const metadata: Metadata = {
  title: 'Вход',
}

export default async function LoginLayout({ children }: LayoutProps<'/login'>) {
  // Уже вошедшему форма входа не нужна. Проверка живёт здесь, а не на главной:
  // лендинг должен оставаться статикой, а /login открывают заметно реже.
  //
  // Спрашиваем именно `getSessionUser`, а не подпись токена: оболочка `/app`
  // требует живого пользователя, и если здесь довериться одной подписи,
  // токен удалённого пользователя начнёт ходить между двумя экранами по кругу.
  // Цена — один запрос к базе, и только когда кука вообще пришла.
  if (await getSessionUser()) redirect('/app')

  return children
}
