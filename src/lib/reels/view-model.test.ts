import { describe, expect, it } from 'vitest'
import type { ReelListRow } from '@/db/queries/list-reels'
import { NO_DATA } from '@/lib/format/number'
import { toCardModel } from './view-model'

/** Тот же неразрывный пробел, что и в форматтерах. Escape, а не символ. */
const NBSP = '\u00A0'

const NOW = new Date('2026-08-24T16:30:00Z')

/** Здоровый рилс со всеми данными. Тесты меняют по одному полю. */
function row(patch: Partial<ReelListRow> = {}): ReelListRow {
  return {
    id: 'reel-1',
    shortcode: 'Cxxxxxx',
    url: 'https://www.instagram.com/reel/Cxxxxxx/',
    caption: 'Как я снимал этот рилс',
    ownerUsername: 'pifpafai',
    thumbnailSrc: null,
    postedAt: new Date('2026-08-21T16:30:00Z'),
    syncStatus: 'ok',
    syncError: null,
    lastSyncedAt: new Date('2026-08-24T16:00:00Z'),
    views: 245_000,
    likes: 8000,
    comments: 200,
    capturedAt: new Date('2026-08-24T16:00:00Z'),
    createdAt: new Date('2026-08-21T17:00:00Z'),
    growth7d: 12_000,
    ...patch,
  }
}

describe('toCardModel — состояние рилса', () => {
  it('pending без единого снапшота — это первая загрузка', () => {
    const model = toCardModel(row({ syncStatus: 'pending', capturedAt: null, views: null }), NOW)

    expect(model.state).toBe('loading')
    expect(model.message).toBe('Забираем данные из Instagram…')
  })

  it('pending со снапшотами — это обновление, старые цифры остаются', () => {
    // Метрики живут в reel_snapshots, поэтому статус pending их не стирает.
    // Блогер видит прошлые просмотры и пульсацию, а не пустую карточку.
    const model = toCardModel(row({ syncStatus: 'pending' }), NOW)

    expect(model.state).toBe('refreshing')
    expect(model.views).not.toBe(NO_DATA)
  })

  it('failed показывает текст ошибки из базы, если он есть', () => {
    const model = toCardModel(
      row({ syncStatus: 'failed', syncError: 'Не получилось забрать данные. Попробуй ещё раз' }),
      NOW,
    )

    expect(model.state).toBe('failed')
    expect(model.message).toBe('Не получилось забрать данные. Попробуй ещё раз')
    expect(model.canRetry).toBe(true)
  })

  it('failed без текста ошибки не оставляет пустое место', () => {
    const model = toCardModel(row({ syncStatus: 'failed', syncError: null }), NOW)

    expect(model.message).toBe('Не получилось забрать данные')
  })

  it('unavailable объясняет причину и не предлагает повтор', () => {
    const model = toCardModel(row({ syncStatus: 'unavailable' }), NOW)

    expect(model.state).toBe('unavailable')
    expect(model.message).toBe('Рилс приватный или удалён')
    expect(model.canRetry).toBe(false)
    expect(model.canSync).toBe(false)
  })

  it('здоровый рилс не показывает никакого сообщения', () => {
    const model = toCardModel(row(), NOW)

    expect(model.state).toBe('ok')
    expect(model.message).toBeNull()
    expect(model.canSync).toBe(true)
  })
})

describe('toCardModel — числа и «нет данных»', () => {
  it('скрытые лайки дают прочерк, а не ноль', () => {
    // Instagram отдаёт -1 при скрытом счётчике, normalizeApifyItem делает null.
    const model = toCardModel(row({ likes: null }), NOW)

    expect(model.likes).toBe(NO_DATA)
  })

  it('настоящий ноль остаётся нулём', () => {
    const model = toCardModel(row({ comments: 0 }), NOW)

    expect(model.comments).toBe('0')
  })

  it('ER считается только когда есть все три числа', () => {
    expect(toCardModel(row({ views: 100_000, likes: 4000, comments: 200 }), NOW).er).toBe('4,2 %')
    expect(toCardModel(row({ likes: null }), NOW).er).toBe(NO_DATA)
    expect(toCardModel(row({ views: null }), NOW).er).toBe(NO_DATA)
  })

  it('скрытый счётчик комментариев даёт прочерк, не ноль', () => {
    // Instagram может скрыть счётчик на любой из трёх метрик. Честнее сказать
    // «неизвестно», чем посчитать ER с пропуском и показать заниженный процент.
    expect(toCardModel(row({ comments: null }), NOW).er).toBe(NO_DATA)
  })

  it('но настоящий ноль лайков и комментариев — это ноль процентов, не «нет данных»', () => {
    // Рилс может быть с нулевым вовлечением, и это валидный результат,
    // отличный от «счётчик скрыт» или «данные ещё не пришли».
    expect(toCardModel(row({ likes: 0, comments: 0 }), NOW).er).toBe('0 %')
  })

  it('ноль просмотров не делит на ноль', () => {
    expect(toCardModel(row({ views: 0 }), NOW).er).toBe(NO_DATA)
  })

  it('в тултипе просмотров лежит точное число', () => {
    const model = toCardModel(row({ views: 1_245_903 }), NOW)

    expect(model.views).toBe(`1,2${NBSP}млн`)
    expect(model.viewsTitle).toBe(`1${NBSP}245${NBSP}903`)
  })
})

describe('toCardModel — бейдж роста', () => {
  it('рост показывается со знаком и направлением', () => {
    const model = toCardModel(row({ growth7d: 12_000 }), NOW)

    expect(model.growth).toEqual({ text: `+12${NBSP}тыс.`, direction: 'up' })
  })

  it('падение помечается направлением вниз', () => {
    const model = toCardModel(row({ growth7d: -340 }), NOW)

    expect(model.growth?.direction).toBe('down')
  })

  it('мало данных — бейджа нет вовсе', () => {
    expect(toCardModel(row({ growth7d: null }), NOW).growth).toBeNull()
  })

  it('нулевой прирост тоже не рисуется', () => {
    // «+0» не сообщает ничего и создаёт вид, будто рилс мёртв.
    expect(toCardModel(row({ growth7d: 0 }), NOW).growth).toBeNull()
  })
})

describe('toCardModel — тексты', () => {
  it('пустая подпись заменяется, а не оставляет дыру', () => {
    expect(toCardModel(row({ caption: null }), NOW).caption).toBe('Без подписи')
    expect(toCardModel(row({ caption: '   ' }), NOW).caption).toBe('Без подписи')
  })

  it('автор показывается с собачкой', () => {
    expect(toCardModel(row(), NOW).author).toBe('@pifpafai')
    expect(toCardModel(row({ ownerUsername: null }), NOW).author).toBeNull()
  })

  it('дата публикации относительная, точная — в тултипе', () => {
    const model = toCardModel(row(), NOW)

    expect(model.posted).toBe('3 дня назад')
    expect(model.postedTitle).toBe('21 августа 2026, 19:30')
  })

  it('свежесть данных подписывается человеческим языком', () => {
    expect(toCardModel(row(), NOW).updated).toBe('обновлено 30 минут назад')
    expect(toCardModel(row({ lastSyncedAt: null }), NOW).updated).toBeNull()
  })

  it('coverVersion — числовая метка синхронизации, не то же самое, что updated', () => {
    // updated — готовая строка вида «обновлено 30 минут назад», она меняется
    // каждую минуту сама по себе. coverVersion — сырой lastSyncedAt.getTime():
    // <ReelCover> сравнивает эту метку, чтобы понять, когда стоит попробовать
    // картинку заново, а постоянно меняющаяся строка для этого не годится.
    expect(toCardModel(row(), NOW).coverVersion).toBe(row().lastSyncedAt!.getTime())
    expect(toCardModel(row({ lastSyncedAt: null }), NOW).coverVersion).toBeNull()
  })
})
