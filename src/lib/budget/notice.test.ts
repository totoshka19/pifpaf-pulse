import { describe, expect, it } from 'vitest'
import { budgetNotice } from './notice'

const usage = (used: number, cap = 1500, period = '2026-08') => ({
  period,
  used,
  cap,
  left: Math.max(0, cap - used),
})

describe('budgetNotice — когда предупреждать о лимите', () => {
  it('лимит не тронут — молчим', () => {
    expect(budgetNotice(usage(0))).toBeNull()
  })

  it('остался один результат — всё ещё молчим', () => {
    // Порог именно НОЛЬ, а не «почти ноль». Предупреждать заранее значит
    // пугать блогера тем, чего ещё не случилось: последний результат
    // потратится штатно и данные придут.
    expect(budgetNotice(usage(1499))).toBeNull()
  })

  it('лимит исчерпан — плашка со сроком обнуления', () => {
    const notice = budgetNotice(usage(1500))

    expect(notice).not.toBeNull()
    expect(notice!.headline).toMatch(/[а-яё]/i)
    // Дата обнуления — первое число СЛЕДУЮЩЕГО месяца после периода счётчика.
    expect(notice!.detail).toContain('1 сентября')
  })

  it('переползание через Новый год: за декабрём идёт январь, а не тринадцатый месяц', () => {
    const notice = budgetNotice(usage(1500, 1500, '2026-12'))

    expect(notice!.detail).toContain('1 января')
  })

  it('перерасход сверх потолка тоже считается исчерпанием', () => {
    // used > cap невозможно через tryReserve, но возможно руками в базе.
    // Молчать в этом случае — худший из вариантов: лимит уж точно исчерпан.
    expect(budgetNotice(usage(1600))).not.toBeNull()
  })

  it('текст без кодов и цифр статуса — только человеческие слова', () => {
    const notice = budgetNotice(usage(1500))

    expect(notice!.headline).not.toMatch(/\d{3}/)
  })
})
