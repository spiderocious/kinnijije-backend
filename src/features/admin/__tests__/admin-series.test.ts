import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { trendPercent } from '../dashboard/admin-series.js';

/**
 * The pure part of the dashboard's series maths.
 *
 * `trendPercent` is small and entirely about its edge cases: the arrow it
 * drives is the most confident-looking thing on the screen, so a wrong sign or
 * a fabricated percentage over a zero base is worse than showing nothing.
 */
describe('trendPercent', () => {
  it('reports growth as a positive whole percent', () => {
    assert.equal(trendPercent(120, 100), 20);
  });

  it('reports decline as a negative whole percent', () => {
    assert.equal(trendPercent(80, 100), -20);
  });

  it('reports no change as zero rather than null', () => {
    // Zero is a real answer and renders a flat marker; null renders nothing.
    assert.equal(trendPercent(100, 100), 0);
  });

  it('returns null when the previous period was zero', () => {
    // The whole point: 0 → 5 has no percentage. Infinity and a confident
    // "100%" are both lies, so the badge is suppressed instead.
    assert.equal(trendPercent(5, 0), null);
  });

  it('returns null when both periods were zero', () => {
    assert.equal(trendPercent(0, 0), null);
  });

  it('reports a total collapse as -100', () => {
    assert.equal(trendPercent(0, 40), -100);
  });

  it('rounds to a whole percent', () => {
    // 1/3 growth is 33.33…; the badge has no room for decimals.
    assert.equal(trendPercent(4, 3), 33);
  });
});
