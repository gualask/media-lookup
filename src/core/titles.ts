/**
 * Folds a title to the form used to compare titles and build cache keys: lowercase, accents
 * removed, punctuation and other non-letter/non-number characters treated as separators.
 * "Dune - Parte due" and "Dune Parte Due" fold to the same string.
 */
export function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function hasLatinLetter(value: string): boolean {
  return /\p{Script=Latin}/u.test(value);
}
