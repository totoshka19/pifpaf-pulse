import Link from 'next/link'

/**
 * Страница «не нашли».
 *
 * Ловит два разных случая одной разметкой: адрес, которого нет вообще, и
 * `notFound()` из серверного компонента — например, рилс, которого у тебя нет.
 * Текст поэтому не обещает, что «страница удалена»: мы не знаем, была ли она.
 *
 * ПРО СТАТУС ОТВЕТА. Здесь он честные 404 — страницу отдаёт Next до начала
 * стриминга. А вот `notFound()`, вызванный из уже стримящегося серверного
 * компонента (`/app/reels/:id`), успевает отправить заголовки раньше, и там
 * ответ остаётся 200 с этой же разметкой. Записано в граблях `AGENTS.md`,
 * кодом не чинится и изоляции не вредит: API отдаёт настоящую 404, а чужой
 * рилс и несуществующий по-прежнему неотличимы.
 *
 * Компонент серверный: ни состояния, ни обработчиков — только ссылки.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
          Ошибка 404
        </p>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Такой страницы нет
        </h1>

        <p className="text-lg text-[var(--muted)]">
          Ссылка ведёт в никуда. Может, адрес набран с опечаткой, а может, рилс
          удалили — из ленты или из самого Instagram.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/app/reels"
          className="rounded-[var(--radius)] bg-[var(--ink)] px-6 py-3 font-medium text-white transition hover:opacity-90"
        >
          К ленте
        </Link>

        <Link
          href="/app"
          className="rounded-[var(--radius)] px-6 py-3 font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          На дашборд
        </Link>
      </div>
    </main>
  )
}
