import { describe, expect, it } from 'vitest'
import { nextPollDelay, POLL_MAX_ATTEMPTS, shouldKeepPolling } from './poll'

describe('nextPollDelay — интервал растёт', () => {
  it('первые попытки частые: прогон Apify идёт 14–19 секунд', () => {
    expect(nextPollDelay(0)).toBe(2000)
    expect(nextPollDelay(9)).toBe(2000)
  })

  it('дальше интервал увеличивается ступенями', () => {
    expect(nextPollDelay(10)).toBe(4000)
    expect(nextPollDelay(20)).toBe(8000)
    expect(nextPollDelay(30)).toBe(15_000)
    expect(nextPollDelay(999)).toBe(15_000)
  })

  it('интервал никогда не убывает', () => {
    const delays = Array.from({ length: POLL_MAX_ATTEMPTS }, (_, i) => nextPollDelay(i))

    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
  })
})

describe('shouldKeepPolling — когда остановиться', () => {
  it('без pending-рилсов опрос не нужен', () => {
    expect(shouldKeepPolling(0, 0)).toBe(false)
  })

  it('пока есть pending и попытки не кончились — продолжаем', () => {
    expect(shouldKeepPolling(0, 1)).toBe(true)
    expect(shouldKeepPolling(POLL_MAX_ATTEMPTS - 1, 1)).toBe(true)
  })

  it('после лимита попыток останавливаемся даже с pending', () => {
    // Иначе забытая в фоне вкладка будет дёргать функции Netlify до вечера.
    expect(shouldKeepPolling(POLL_MAX_ATTEMPTS, 3)).toBe(false)
  })
})
