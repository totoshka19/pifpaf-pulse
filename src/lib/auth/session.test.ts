import { SignJWT, UnsecuredJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { signSession, verifySession } from './session'

const SECRET = 'test-secret-at-least-32-characters-long'

beforeAll(() => {
  process.env.JWT_SECRET = SECRET
})

const key = (value: string) => new TextEncoder().encode(value)
const nowSec = () => Math.floor(Date.now() / 1000)

describe('сессия — обычный путь', () => {
  it('подписывает и читает обратно', async () => {
    const token = await signSession({ userId: 'u-1', role: 'admin' })
    expect(await verifySession(token)).toEqual({ userId: 'u-1', role: 'admin' })
  })

  it('сохраняет роль блогера', async () => {
    const token = await signSession({ userId: 'u-2', role: 'blogger' })
    expect(await verifySession(token)).toEqual({ userId: 'u-2', role: 'blogger' })
  })
})

describe('сессия — отказы', () => {
  it('отвергает подделанный токен', async () => {
    const token = await signSession({ userId: 'u-1', role: 'blogger' })
    expect(await verifySession(token.slice(0, -3) + 'aaa')).toBeNull()
  })

  it('отвергает мусор и пустоту', async () => {
    expect(await verifySession('не-токен')).toBeNull()
    expect(await verifySession('')).toBeNull()
    expect(await verifySession(undefined)).toBeNull()
  })

  it('отвергает токен, подписанный чужим ключом', async () => {
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-hacker')
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(key('совершенно-другой-секрет-длиной-в-32-символа'))

    expect(await verifySession(token)).toBeNull()
  })

  it('отвергает протухший токен', async () => {
    const token = await new SignJWT({ role: 'blogger' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-1')
      .setIssuedAt(nowSec() - 7200)
      .setExpirationTime(nowSec() - 3600)
      .sign(key(SECRET))

    expect(await verifySession(token)).toBeNull()
  })

  it('отвергает токен без подписи (alg: none)', async () => {
    // Классическая атака: заголовок меняют на {"alg":"none"}, подпись отрезают.
    // Регрессионный тест на границу, а не на текущую логику: jose отвергает
    // такой токен и без опции algorithms. Тест сработает, если библиотеку
    // заменят на менее строгую или расширят список допустимых алгоритмов.
    const token = new UnsecuredJWT({ role: 'admin' }).setSubject('u-hacker').encode()

    expect(await verifySession(token)).toBeNull()
  })

  it('отвергает валидно подписанный токен без sub', async () => {
    const token = await new SignJWT({ role: 'blogger' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(key(SECRET))

    expect(await verifySession(token)).toBeNull()
  })
})

describe('сессия — роль по белому списку', () => {
  it('неизвестную роль понижает до blogger, а не пропускает', async () => {
    const token = await new SignJWT({ role: 'superadmin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-1')
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(key(SECRET))

    expect(await verifySession(token)).toEqual({ userId: 'u-1', role: 'blogger' })
  })

  it('отсутствующую роль считает blogger', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-1')
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(key(SECRET))

    expect(await verifySession(token)).toEqual({ userId: 'u-1', role: 'blogger' })
  })
})
