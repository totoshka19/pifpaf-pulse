import { describe, expect, it } from 'vitest'
import { checkManualSync, MANUAL_SYNC_COOLDOWN_MS } from './throttle'

const NOW = new Date('2026-08-24T16:30:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('checkManualSync — троттлинг ручного обновления', () => {
  it('рилс, который ни разу не синхронизировали, обновлять можно', () => {
    expect(checkManualSync(null, NOW)).toEqual({ allowed: true })
  })

  it('после часа простоя обновлять можно', () => {
    expect(checkManualSync(ago(MANUAL_SYNC_COOLDOWN_MS), NOW).allowed).toBe(true)
    expect(checkManualSync(ago(MANUAL_SYNC_COOLDOWN_MS + 1000), NOW).allowed).toBe(true)
  })

  it('внутри часа обновление запрещено', () => {
    const verdict = checkManualSync(ago(10 * 60_000), NOW)

    expect(verdict.allowed).toBe(false)
  })

  it('в отказе сказано, сколько ждать, и склонение верное', () => {
    // Никаких кодов и «rate limit exceeded»: PLAN.md §12.
    const verdict = checkManualSync(ago(59 * 60_000), NOW)

    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.message).toContain('через 1 минуту')
      expect(verdict.message).not.toMatch(/\d{3}/)
    }
  })

  it('склонение работает и на других остатках', () => {
    const two = checkManualSync(ago(58 * 60_000), NOW)
    const many = checkManualSync(ago(35 * 60_000), NOW)

    if (!two.allowed) expect(two.message).toContain('через 2 минуты')
    if (!many.allowed) expect(many.message).toContain('через 25 минут')
  })

  it('часы, уехавшие вперёд, не блокируют обновление навсегда', () => {
    // lastSyncedAt из будущего дал бы отрицательную разницу и запрет на час.
    expect(checkManualSync(new Date(NOW.getTime() + 10 * 60_000), NOW).allowed).toBe(true)
  })
})
