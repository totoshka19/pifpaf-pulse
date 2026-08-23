/**
 * Русское склонение по числу.
 *
 * Формы задаются как [1 рилс, 2 рилса, 5 рилсов]. Правило CLDR для русского:
 * сотни не влияют, решают две последние цифры.
 */
export function plural(
  count: number,
  forms: readonly [string, string, string],
): string {
  const n = Math.abs(Math.trunc(count))

  // 11–14 — исключение: они оканчиваются на 1–4, но склоняются как множественное.
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2]

  const last = n % 10
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}
