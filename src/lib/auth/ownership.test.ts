import { describe, expect, it } from 'vitest'
import { assertOwned, NotFoundError } from './ownership'
import type { Session } from './session'

const blogger: Session = { userId: 'u-1', role: 'blogger' }
const admin: Session = { userId: 'u-admin', role: 'admin' }

describe('assertOwned — свои записи', () => {
  it('пропускает свою запись', () => {
    const row = { id: 'r-1', userId: 'u-1' }
    expect(assertOwned(row, blogger)).toBe(row)
  })

  it('возвращает ту же ссылку, а не копию', () => {
    const row = { id: 'r-1', userId: 'u-1', caption: 'текст' }
    expect(assertOwned(row, blogger)).toBe(row)
  })
})

describe('assertOwned — чужое неотличимо от несуществующего', () => {
  it('прячет чужую запись как 404, а не 403', () => {
    expect(() => assertOwned({ id: 'r-2', userId: 'u-2' }, blogger)).toThrow(
      NotFoundError,
    )
  })

  it('несуществующую запись отдаёт тем же 404', () => {
    expect(() => assertOwned(undefined, blogger)).toThrow(NotFoundError)
    expect(() => assertOwned(null, blogger)).toThrow(NotFoundError)
  })

  it('оба случая дают одинаковую ошибку — снаружи их не различить', () => {
    let foreign: unknown
    let missing: unknown
    try {
      assertOwned({ id: 'r-2', userId: 'u-2' }, blogger)
    } catch (error) {
      foreign = error
    }
    try {
      assertOwned(undefined, blogger)
    } catch (error) {
      missing = error
    }

    expect((foreign as NotFoundError).status).toBe(404)
    expect((foreign as NotFoundError).message).toBe((missing as NotFoundError).message)
  })
})

describe('assertOwned — админ не обходит проверку', () => {
  it('роль admin не даёт доступа к чужой записи', () => {
    // Осознанное решение: админ видит агрегаты в лидерборде отдельным запросом,
    // но сырые записи чужих блогеров через этот guard не получает.
    expect(() => assertOwned({ id: 'r-2', userId: 'u-2' }, admin)).toThrow(NotFoundError)
  })
})
