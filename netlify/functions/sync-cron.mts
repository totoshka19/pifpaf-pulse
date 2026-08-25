import type { Config } from '@netlify/functions'

/**
 * Планировщик фоновой синхронизации.
 *
 * ТОНКИЙ ТРИГГЕР И НИЧЕГО БОЛЬШЕ. Netlify даёт планируемой функции 30 секунд
 * против десяти у обычной, и соблазн перенести сюда логику есть. Нельзя:
 * этот файл лежит ВНЕ сборки Next.js и не импортирует ни `ingestReel`,
 * ни `computeNextSyncAt`, ни `tryReserve`. Продублировать их значит завести
 * вторую реализацию приёма данных, которая разойдётся с первой на первой же
 * правке.
 *
 * Поэтому функция делает один запрос на собственный `/api/cron/sync`,
 * где живёт вся логика и куда ходят тесты.
 */
export default async function handler(): Promise<Response> {
  // ОТКЛОНЕНИЕ ОТ ПЛАНА, ОСОЗНАННОЕ. План брал только NEXT_PUBLIC_APP_URL.
  // Эта переменная не используется больше нигде в коде — она живёт лишь в
  // `.env.local`, который на Netlify не уезжает. То есть в проде её почти
  // наверняка нет, функция вернула бы 500 на каждом тике, и синхронизация
  // молча не работала бы вообще, а в панели всё выглядело бы исправным:
  // функция есть, расписание есть, вызовы идут.
  //
  // `URL` Netlify подставляет сам — это адрес боевого деплоя. Порядок именно
  // такой: явно заданный NEXT_PUBLIC_APP_URL сильнее, чтобы при переезде на
  // свой домен хватило одной переменной в панели и правка кода не понадобилась.
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL
  const secret = process.env.CRON_SECRET

  if (!base || !secret) {
    // Разные причины разводятся в тексте: искать незаданную переменную в
    // панели Netlify по сообщению «не настроено» — это перебор всех подряд.
    console.error(
      '[cron] не настроено:',
      !base ? 'нет ни NEXT_PUBLIC_APP_URL, ни URL' : 'нет CRON_SECRET',
    )
    return new Response('not configured', { status: 500 })
  }

  const response = await fetch(`${base}/api/cron/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  })

  const body = await response.text()
  console.log('[cron]', response.status, body)

  return new Response(body, { status: response.status })
}

export const config: Config = {
  // Каждые 15 минут. Самая частая ступень расписания — час, так что четыре
  // тика в час дают запас на пропущенный и не создают лишней нагрузки.
  schedule: '*/15 * * * *',
}
