/**
 * Пустое состояние с настоящим примером ссылки.
 *
 * Иллюстрация нарисована средствами CSS: картинка в `public/` — лишний запрос
 * и лишний вес ради экрана, который блогер увидит один раз в жизни.
 */
export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white/50 px-6 py-16 text-center">
      <div className="flex h-20 w-14 items-center justify-center rounded-xl bg-linear-to-br from-[var(--accent-soft)] to-white text-2xl shadow-[var(--shadow)]">
        🎬
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-lg font-medium">Пока пусто</p>
        <p className="max-w-sm text-sm text-[var(--muted)]">
          Вставь ссылку на свой рилс в поле сверху — просмотры, дата и обложка
          подтянутся сами за пару секунд.
        </p>
      </div>

      <code className="rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-xs text-[var(--ink)]">
        instagram.com/reel/Cxxxxxx/
      </code>
    </div>
  )
}
