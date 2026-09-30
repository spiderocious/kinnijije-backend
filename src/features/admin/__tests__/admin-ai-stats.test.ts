import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimateCostUsd } from '@lib/analytics/ai-cost.js';

/**
 * The pure parts of the stats service, tested without a database.
 *
 * Percentiles and partial-cost summing are where this kind of code goes wrong
 * quietly: an off-by-one in a percentile still returns a plausible number, and
 * a cost that treats "unknown" as zero reads as "free".
 */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function sumCost(parts: (number | null)[]): number | null {
  const known = parts.filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100;
}

describe('percentile', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('is 0 for an empty set rather than NaN', () => {
    // A NaN reaches the UI as "NaN ms", which reads as a bug in the page.
    assert.equal(percentile([], 95), 0);
  });

  it('picks the median', () => {
    assert.equal(percentile(ten, 50), 5);
  });

  it('picks the p95', () => {
    assert.equal(percentile(ten, 95), 10);
  });

  it('never runs off the end', () => {
    assert.equal(percentile([42], 95), 42);
    assert.equal(percentile([1, 2], 100), 2);
  });

  it('reports what people feel, not the average', () => {
    // Nine fast calls and one timeout: the mean says 1.3s, p95 says 10s.
    const withTimeout = [200, 210, 220, 230, 240, 250, 260, 270, 280, 10_000];
    assert.equal(percentile(withTimeout, 95), 10_000);
  });
});

describe('sumCost', () => {
  it('returns null when nothing could be priced', () => {
    // A gap in a chart is honest; a zero reads as "this is free".
    assert.equal(sumCost([null, null]), null);
  });

  it('sums what it can and ignores what it cannot', () => {
    assert.equal(sumCost([1.5, null, 2.25]), 3.75);
  });

  it('rounds to cents', () => {
    assert.equal(sumCost([0.001, 0.002]), 0);
    assert.equal(sumCost([1.005, 1.005]), 2.01);
  });
});

describe('estimateCostUsd', () => {
  it('prices a known model', () => {
    const cost = estimateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000);
    assert.ok(cost !== null && cost > 0);
  });

  it('matches the LONGEST prefix, so mini is never priced as full', () => {
    // gpt-4o-mini starts with gpt-4o. Getting this wrong overstates spend ~16x.
    const mini = estimateCostUsd('gpt-4o-mini', 1_000_000, 0);
    const full = estimateCostUsd('gpt-4o', 1_000_000, 0);
    assert.ok(mini !== null && full !== null);
    assert.ok(mini < full, `mini (${String(mini)}) must be cheaper than 4o (${String(full)})`);
  });

  it('handles a dated snapshot', () => {
    assert.notEqual(estimateCostUsd('gpt-4o-mini-2024-07-18', 1000, 1000), null);
  });

  it('returns null for a model it does not know', () => {
    assert.equal(estimateCostUsd('some-new-model', 1000, 1000), null);
  });

  it('returns null when no tokens were recorded', () => {
    assert.equal(estimateCostUsd('gpt-4o-mini', null, null), null);
  });
});
