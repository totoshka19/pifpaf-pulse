'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        router.push('/login')
        router.refresh()
      }}
      className="self-start rounded-xl border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--chip)] disabled:opacity-50"
    >
      {busy ? 'Выходим…' : 'Выйти'}
    </button>
  )
}
