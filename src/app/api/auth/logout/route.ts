import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/cookie'

export const runtime = 'nodejs'

export async function POST() {
  return clearSessionCookie(NextResponse.json({ ok: true }))
}
