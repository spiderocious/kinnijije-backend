/**
 * Dollar-per-million-token rates, for turning token counts into money.
 *
 * Deliberately approximate and deliberately local: the point is a spend trend
 * you can act on ("chat tripled this week"), not an invoice. Vendor pricing
 * moves, so an unknown model yields null rather than a wrong number — a gap in
 * a chart is honest, a confidently wrong cost is not.
 *
 * Keys are matched as PREFIXES, so `gpt-4o-mini-2024-07-18` finds `gpt-4o-mini`
 * and a dated snapshot does not silently fall through to unknown.
 */
interface Rate {
  readonly inPerMillion: number;
  readonly outPerMillion: number;
}

const RATES: ReadonlyArray<readonly [string, Rate]> = [
  ['gpt-4o-mini', { inPerMillion: 0.15, outPerMillion: 0.6 }],
  ['gpt-4o', { inPerMillion: 2.5, outPerMillion: 10 }],
  ['gpt-4.1-mini', { inPerMillion: 0.4, outPerMillion: 1.6 }],
  ['gpt-4.1-nano', { inPerMillion: 0.1, outPerMillion: 0.4 }],
  ['gpt-4.1', { inPerMillion: 2, outPerMillion: 8 }],
  ['gpt-5-mini', { inPerMillion: 0.25, outPerMillion: 2 }],
  ['gpt-5', { inPerMillion: 1.25, outPerMillion: 10 }],
  ['o4-mini', { inPerMillion: 1.1, outPerMillion: 4.4 }],
  ['whisper', { inPerMillion: 0, outPerMillion: 0 }],
];

/**
 * Estimated cost in USD, or null when the model is not in the table.
 *
 * Longest prefix wins, so `gpt-4o-mini` is never mistaken for `gpt-4o`.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number | null,
  completionTokens: number | null,
): number | null {
  if (promptTokens === null && completionTokens === null) return null;

  const match = RATES.filter(([prefix]) => model.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  if (match === undefined) return null;

  const [, rate] = match;
  const cost =
    ((promptTokens ?? 0) / 1_000_000) * rate.inPerMillion +
    ((completionTokens ?? 0) / 1_000_000) * rate.outPerMillion;

  // Six decimals: a single cheap call is fractions of a cent, and rounding to
  // four would report most of them as zero.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
