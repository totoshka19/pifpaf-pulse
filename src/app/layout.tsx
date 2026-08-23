import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

/**
 * subsets обязателен и обязан включать 'cyrillic': next/font скачивает и
 * самостоятельно хостит ТОЛЬКО запрошенные подмножества. Без кириллицы весь
 * русский интерфейс молча подставился бы системным шрифтом — вперемешку
 * с латиницей, набранной Geist'ом.
 */
const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'PifPaf Pulse — аналитика рилсов',
    template: '%s · PifPaf Pulse',
  },
  description:
    'Внутренний сервис аналитики для блогеров PifPaf AI. Вставь ссылку на рилс — ' +
    'просмотры, дата и обложка подтянутся сами и будут обновляться.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ru" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
