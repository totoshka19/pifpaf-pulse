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

/**
 * База для абсолютных адресов в мета-тегах.
 *
 * Без неё Next при СБОРКЕ подставляет `http://localhost:3000` — и статический
 * лендинг (`○` в выводе build) уносит этот адрес в прод намертво. Превью
 * ссылки в телеграме тогда пытается загрузить картинку с локалхоста
 * получателя и не показывает ничего, а заметить это можно только со стороны,
 * уже отправив ссылку.
 *
 * `URL` на Netlify объявлен всегда и указывает на боевой деплой; порядок тот
 * же, что в `netlify/functions/sync-cron.mts`: явный `NEXT_PUBLIC_APP_URL`
 * сильнее, чтобы переезд на свой домен стоил одной переменной в панели.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
