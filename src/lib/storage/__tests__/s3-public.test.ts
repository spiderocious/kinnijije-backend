import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PUBLIC_PREFIX, putPublicObject } from '../s3.js';

/**
 * The prefix guard is a SECURITY boundary, not a naming convention: anything
 * under `public/` is served without a signature, so a key that slips outside it
 * would publish a user's private upload to an unauthenticated URL.
 *
 * These assert the refusal, which happens before any network call — so they
 * need no bucket, no credentials and no fixtures.
 */
describe('putPublicObject', () => {
  const body = new Uint8Array([1, 2, 3]);

  it('refuses a key outside the public prefix', async () => {
    await assert.rejects(
      () => putPublicObject({ key: 'shelf_photo/u_123/secret.png', body, contentType: 'image/png' }),
      /refuses a key outside public\//,
    );
  });

  it('refuses a bare filename', async () => {
    await assert.rejects(
      () => putPublicObject({ key: 'hero.webp', body, contentType: 'image/webp' }),
      /refuses a key outside/,
    );
  });

  it('refuses a key that only mentions public further along', async () => {
    // `startsWith`, not `includes` — "uploads/public/x" is NOT public.
    await assert.rejects(
      () => putPublicObject({ key: 'uploads/public/x.png', body, contentType: 'image/png' }),
      /refuses a key outside/,
    );
  });

  it('exposes the prefix it enforces', () => {
    assert.equal(PUBLIC_PREFIX, 'public/');
  });
});
