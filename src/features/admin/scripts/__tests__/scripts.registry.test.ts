import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SCRIPTS, scriptById } from '../scripts.registry.js';

/**
 * The registry is an operator-facing list, and every field in it is read by
 * somebody deciding whether to press a button on production data. A missing
 * description or a mislabelled destructive flag is a real hazard, not a typo.
 */
describe('script registry', () => {
  it('has unique ids', () => {
    const ids = SCRIPTS.map((script) => script.id);
    assert.equal(new Set(ids).size, ids.length, 'two scripts share an id');
  });

  it('uses url-safe ids, since they travel in a path', () => {
    for (const script of SCRIPTS) {
      assert.match(script.id, /^[a-z0-9-]+$/, `${script.id} is not url-safe`);
    }
  });

  it('describes what it does and what it changes', () => {
    for (const script of SCRIPTS) {
      assert.ok(script.name.length > 0, `${script.id} has no name`);
      assert.ok(
        script.description.length > 20,
        `${script.id} needs a description an operator can act on`,
      );
      assert.ok(script.effect.length > 0, `${script.id} does not say what it changes`);
    }
  });

  it('resolves by id, and refuses anything else', () => {
    for (const script of SCRIPTS) {
      assert.equal(scriptById(script.id)?.id, script.id);
    }
    // The path param is validated against this, so an unknown id must be a
    // miss rather than anything cleverer.
    assert.equal(scriptById('../../etc/passwd'), undefined);
    assert.equal(scriptById(''), undefined);
    assert.equal(scriptById('constructor'), undefined);
  });

  it('offers a dry run wherever it writes', () => {
    // A read-only report does not need one; anything that writes does, because
    // "what would this do" is the first question an operator asks.
    for (const script of SCRIPTS) {
      if (script.effect.startsWith('Reads only')) continue;
      assert.equal(
        script.supportsDryRun,
        true,
        `${script.id} writes but cannot be previewed`,
      );
    }
  });
});
