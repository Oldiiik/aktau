// Text normalisation shared by the seed builder, the announcement parser and
// local search. Deterministic, dependency-free.

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
}

/** Lower-case, fold ё→е, collapse whitespace, unify dashes and quotes. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‐-―−]/g, '-')
    .replace(/[«»“”„"]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * House numbers as written locally: '46Б', '46 б', '12/2', '18A' (Latin A).
 * Normalised: upper-case, no spaces, Latin look-alikes folded to Cyrillic.
 */
export function normalizeHouseNumber(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[№#]/g, '')
    .replace(/\s+/g, '')
    .replace(/[ABCEHKMOPTXY]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch)
    .replace(/^0+(?=\d)/, '')
}

const NAMED_DISTRICTS: Array<{ re: RegExp; designator: (n?: string) => string }> = [
  { re: /^(?:шыгыс|шығыс|shygys|shyghys)[\s-]*(\d)$/, designator: (n) => `ШЫГЫС-${n}` },
  { re: /^(?:толкын|толқын|tolkyn|tolqyn)[\s-]*(\d)$/, designator: (n) => `ТОЛКЫН-${n}` },
  { re: /^(?:толкын|толқын|tolkyn|tolqyn)$/, designator: () => 'ТОЛКЫН-1' },
  { re: /^(?:самал|samal)$/, designator: () => 'САМАЛ' },
]

const MKR_WORDS = /(?:микрорайон[а-я]*|мкр\.?|мкрн\.?|м-н|шағын\s*аудан[а-яәғқңөұүһі]*|шагын\s*аудан[а-я]*|microdistrict|mkr\.?)/

/**
 * Parses a microdistrict designator from free text such as
 * '14 микрорайон', '14-й мкр', 'мкр. 3А', 'микрорайон 32В', '14 шағын аудан',
 * 'Шыгыс-2 микрорайон'. Returns the canonical designator ('14', '3А',
 * 'ШЫГЫС-2') or null. Only accepts text that is *about* a microdistrict.
 */
export function parseDistrictDesignator(raw: string): string | null {
  const t = normalizeText(raw).replace(/quarter|квартал/g, '')
  let m = t.match(new RegExp(`^(?:${MKR_WORDS.source})\\s*(\\d{1,2}\\s?[а-яa-z]?)$`))
    ?? t.match(new RegExp(`^(\\d{1,2}\\s?[а-яa-z]?)(?:-?(?:й|ый|ой|ші|шы))?\\s*${MKR_WORDS.source}$`))
  if (m?.[1]) return canonicalNumberDesignator(m[1])
  const named = t.replace(MKR_WORDS, '').replace(/\s+/g, ' ').trim()
  for (const n of NAMED_DISTRICTS) {
    const nm = named.match(n.re)
    if (nm) return n.designator(nm[1])
  }
  return null
}

export function canonicalNumberDesignator(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/[ABCEHKMOPTXY]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch)
}

const TRANSLIT: Record<string, string> = {
  А: 'a', Б: 'b', В: 'v', Г: 'g', Д: 'd', Е: 'e', Ж: 'zh', З: 'z', И: 'i', Й: 'y', К: 'k', Л: 'l', М: 'm', Н: 'n',
  О: 'o', П: 'p', Р: 'r', С: 's', Т: 't', У: 'u', Ф: 'f', Х: 'kh', Ц: 'ts', Ч: 'ch', Ш: 'sh', Щ: 'sch', Ы: 'y',
  Э: 'e', Ю: 'yu', Я: 'ya', Ә: 'a', Ғ: 'g', Қ: 'q', Ң: 'n', Ө: 'o', Ұ: 'u', Ү: 'u', Һ: 'h', І: 'i',
}

/** Stable URL-safe slug for a designator: '14' → 'mkr-14', '3А' → 'mkr-3a', 'ШЫГЫС-2' → 'shygys-2'. */
export function designatorSlug(designator: string): string {
  const latin = designator.split('').map((c) => TRANSLIT[c] ?? c.toLowerCase()).join('')
  return /^\d/.test(designator) ? `mkr-${latin}` : latin.toLowerCase()
}

export function isNumberDesignator(designator: string): boolean {
  return /^\d/.test(designator)
}

/** Human names for an area designator in the three app languages. */
export function districtNames(designator: string): { en: string; ru: string; kk: string } {
  if (isNumberDesignator(designator)) {
    const plain = /^\d+$/.test(designator)
    return {
      en: `${designator} microdistrict`,
      ru: plain ? `${designator}-й микрорайон` : `микрорайон ${designator}`,
      kk: `${designator} шағын аудан`,
    }
  }
  const [base, n] = designator.split('-')
  const names: Record<string, { en: string; ru: string; kk: string }> = {
    ШЫГЫС: { en: `Shygys-${n}`, ru: `Шыгыс-${n}`, kk: `Шығыс-${n}` },
    ТОЛКЫН: { en: `Tolkyn-${n}`, ru: `Толкын-${n}`, kk: `Толқын-${n}` },
    САМАЛ: { en: 'Samal', ru: 'Самал', kk: 'Самал' },
  }
  const found = names[base ?? '']
  return found
    ? { en: `${found.en} microdistrict`, ru: `микрорайон ${found.ru}`, kk: `${found.kk} шағын ауданы` }
    : { en: designator, ru: designator, kk: designator }
}

/** Lower-case search haystack with aliases so '14', '14 мкр', 'mkr 14' all hit. */
export function districtSearchText(designator: string): string {
  const n = districtNames(designator)
  const d = designator.toLowerCase()
  return normalizeText([
    d, `${d} мкр`, `мкр ${d}`, `${d} mkr`, `mkr ${d}`, `${d}-й`, n.en, n.ru, n.kk,
    designatorSlug(designator).replace('-', ' '),
  ].join(' | '))
}
