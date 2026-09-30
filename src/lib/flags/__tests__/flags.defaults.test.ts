import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FAIL_CLOSED_FLAGS, FEATURE_FLAGS } from '../flags.model.js';

/**
 * Which flags are allowed to assume "on" when nothing is stored.
 *
 * The default answers TWO questions at once — what to serve on a fresh install
 * with no rows, and what to serve when the database is unreachable. A flag
 * that DOES something to a person rather than merely offering it must not be
 * guessed at in either case.
 */
describe('fail-closed flags', () => {
  it('includes the product tour', () => {
    // THE REGRESSION. With no row stored, the tour defaulted to on and
    // ambushed every visitor to the public front door. It is also only ever
    // seen once, so a wrongly-shown tour is a permanently-spent one.
    assert.ok(
      FAIL_CLOSED_FLAGS.includes(FEATURE_FLAGS.ONBOARDING_TOUR),
      'the tour must be off until an operator turns it on',
    );
  });

  it('includes both analytics switches', () => {
    // Assuming on would resume tracking somebody who was switched off.
    assert.ok(FAIL_CLOSED_FLAGS.includes(FEATURE_FLAGS.ANALYTICS_CLIENT));
    assert.ok(FAIL_CLOSED_FLAGS.includes(FEATURE_FLAGS.ANALYTICS_SERVER));
  });

  it('includes the decide invite, which is an experiment', () => {
    assert.ok(FAIL_CLOSED_FLAGS.includes(FEATURE_FLAGS.DECIDE_INVITE));
  });

  it('leaves the ordinary capability flags failing open', () => {
    // A flaky read must not strip working features out of the product.
    assert.ok(!FAIL_CLOSED_FLAGS.includes(FEATURE_FLAGS.UPLOAD_RECEIPT));
    assert.ok(!FAIL_CLOSED_FLAGS.includes(FEATURE_FLAGS.UPLOAD_PHOTO));
  });
});
