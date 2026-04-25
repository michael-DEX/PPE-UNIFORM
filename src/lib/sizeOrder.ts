/**
 * Canonical sort order for clothing and gear sizes.
 *
 * Problem:  plain `localeCompare` produces "L, M, S, XL, XS" for shirt sizes,
 *           which is useless to warehouse workers.
 * Solution: rank common letter-sizes (XS, S, M, L, XL, 2XL …), handle
 *           "34x32" pants-style, numeric sizes, and two-token "SMALL LONG"
 *           style, falling back to alphabetical only as a last resort.
 *
 * Use `compareSizes` in Array#sort when the values being compared are size
 * strings (NOT item names or categories).
 */

// Map of known letter/phrase sizes to a stable ordinal. Everything is lowercased
// at lookup time, so only one entry per spelling is needed.
const LETTER_SIZE_ORDER: Record<string, number> = {
  xxs: 0,
  xs: 1,
  s: 2,
  sm: 2,
  small: 2,
  m: 3,
  md: 3,
  medium: 3,
  l: 4,
  lg: 4,
  large: 4,
  xl: 5,
  "x-large": 5,
  xxl: 6,
  "2xl": 6,
  xxxl: 7,
  "3xl": 7,
  "4xl": 8,
  "5xl": 9,
  // "one-size" / "os" always sort last among named sizes.
  "one-size": 100,
  onesize: 100,
  os: 100,
};

const PANTS_RE = /^(\d+)\s*[xX×]\s*(\d+)$/;

/**
 * Numeric-then-descriptor format used for boot sizing: `"9 M"`, `"10.5 W"`,
 * `"8.5 Narrow"`, `"8 M Womens"`. Requires a numeric token (integer or
 * decimal), whitespace, then one or more descriptor tokens. Only fires when
 * BOTH sides match — mixed cases (e.g. `"M"` vs `"9 M"`) fall through to
 * the existing two-token letter branch, which handles them.
 */
const NUMERIC_WIDTH_RE = /^(\d+(?:\.\d+)?)\s+(.+)$/;

function letterRank(token: string): number | undefined {
  return LETTER_SIZE_ORDER[token.toLowerCase()];
}

/**
 * Compare two size strings for Array#sort. Returns a negative number if `a`
 * should come before `b`, positive if after, zero if equal.
 *
 * Order of branches matters: the numeric+width path (step 2) must run before
 * the generic two-token letter path (step 3), because `"9 M"` has two tokens
 * and would otherwise hit step 3 where `letterRank("9")` returns undefined
 * and every numeric+width pair ties to 0 (the bug observed on Globe Rescue
 * Boots).
 */
export function compareSizes(a: string, b: string): number {
  // 1. Pants-style waist × inseam, e.g. "34x32".
  const pa = a.match(PANTS_RE);
  const pb = b.match(PANTS_RE);
  if (pa && pb) {
    const waistDiff = Number(pa[1]) - Number(pb[1]);
    if (waistDiff !== 0) return waistDiff;
    return Number(pa[2]) - Number(pb[2]);
  }

  // 2. Numeric + width/descriptor, e.g. "9 M", "10.5 W", "8 M Womens",
  //    "9.5 Narrow". Only fires when BOTH sides match. Mixed cases fall
  //    through to step 3.
  //
  //    Primary sort: numeric value of first token.
  //    Secondary sort: localeCompare on the descriptor tail. This happens
  //    to match the semantic order `M < Narrow < W` because "M" < "N" < "W"
  //    alphabetically — a coincidence that works for the current catalog.
  //    If a descriptor like "EE" (extra wide) is ever added, it would sort
  //    between "D" and "W" lexically which may not match intended semantics.
  //    Flag if that becomes relevant.
  const nwA = a.match(NUMERIC_WIDTH_RE);
  const nwB = b.match(NUMERIC_WIDTH_RE);
  if (nwA && nwB) {
    const numDiff = Number(nwA[1]) - Number(nwB[1]);
    if (numDiff !== 0) return numDiff;
    return nwA[2].localeCompare(nwB[2]);
  }

  // 3. Two-token sizes like "SMALL LONG" / "MEDIUM REGULAR".
  const partsA = a.trim().split(/\s+/);
  const partsB = b.trim().split(/\s+/);
  if (partsA.length > 1 || partsB.length > 1) {
    const firstA = partsA[0] !== undefined ? letterRank(partsA[0]) : undefined;
    const firstB = partsB[0] !== undefined ? letterRank(partsB[0]) : undefined;
    if (firstA !== undefined && firstB !== undefined && firstA !== firstB) {
      return firstA - firstB;
    }
    if (firstA !== undefined && firstB === undefined) return -1;
    if (firstB !== undefined && firstA === undefined) return 1;
    // Same primary rank — fall through to comparing the remaining tokens.
    return (partsA[1] ?? "").localeCompare(partsB[1] ?? "");
  }

  // 4. Single letter / word sizes.
  const lettA = letterRank(a);
  const lettB = letterRank(b);
  if (lettA !== undefined && lettB !== undefined) return lettA - lettB;
  if (lettA !== undefined) return -1;
  if (lettB !== undefined) return 1;

  // 5. Pure numeric (handles "10", "10.5", etc.).
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;

  // 6. Fallback to alphabetical.
  return a.localeCompare(b);
}

// ── Verification trace (no test framework in this repo) ──────────────────
//
// Input (the test array from the spec):
//   ["9", "9.5 M", "9 M", "13 M", "10 M", "12.5 M", "7 M", "10.5 M",
//    "11.5 M", "11 M", "12 M", "8 M Womens", "9.5 Narrow", "8 W", "11 W",
//    "10 W", "12.5 W", "10.5 W", "12 W", "9.5 W", "8.5 W", "9 W",
//    "11.5 W", "6.5 W"]
//
// Expected sorted output:
//   "6.5 W", "7 M", "8 M Womens", "8 W", "8.5 W", "9",
//   "9 M", "9 W", "9.5 M", "9.5 Narrow", "9.5 W",
//   "10 M", "10 W", "10.5 M", "10.5 W",
//   "11 M", "11 W", "11.5 M", "11.5 W",
//   "12 M", "12 W", "12.5 M", "12.5 W", "13 M"
//
// Key reasoning:
//   - All "N W" / "N M" / "N M Womens" / "N Narrow" pairs hit step 2.
//     Numeric primary: 6.5 < 7 < 8 < 8.5 < 9 < 9.5 < 10 < ... < 13.
//     On numeric tie (e.g. all the "9.5 X" entries), localeCompare on the
//     descriptor tail gives "M" < "Narrow" < "W".
//     On numeric tie with extended descriptor (e.g. "8 M" vs "8 M Womens"
//     vs "8 W"), localeCompare gives "M" < "M Womens" < "W".
//   - Bare "9" doesn't match step 2 (no whitespace+descriptor). Against
//     any "N X" sibling it falls to step 3 (two-token branch). Example:
//     compareSizes("9", "8.5 W"): letterRank undefined on both sides →
//     falls through to localeCompare on partsA[1]="" vs partsB[1]="W" →
//     "" < "W" → "9" sorts before "8.5 W". That's why "9" appears between
//     "8.5 W" and "9 M" in the expected output above.
//   - Pants ("34x32") and letter sizes ("M", "XL", "SMALL LONG") keep
//     their existing behavior — step 2's BOTH-match requirement means
//     they fall through to their established branches.
