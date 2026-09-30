import Mixpanel from 'mixpanel';

import { logger } from '@lib/logger/index.js';

import type { AnalyticsProvider, EventProperties } from './analytics.types.js';

/**
 * Mixpanel, and the only file in the backend that imports its SDK.
 *
 * The vendor's reserved property names (`$email`, `$created`, `$name`) are
 * translated HERE and nowhere else — a call site says `email` and this decides
 * what Mixpanel calls it. That is what keeps the rest of the codebase free of
 * one analytics vendor's spelling.
 */

/** Our name → Mixpanel's reserved name. */
const RESERVED: Record<string, string> = {
  email: '$email',
  name: '$name',
  created_at: '$created',
  first_name: '$first_name',
  last_name: '$last_name',
  phone: '$phone',
  city: '$city',
  country: '$country_code',
};

function toMixpanelProfile(properties: EventProperties): EventProperties {
  const out: EventProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    out[RESERVED[key] ?? key] = value;
  }
  return out;
}

export class MixpanelProvider implements AnalyticsProvider {
  readonly name = 'mixpanel';
  private readonly client: Mixpanel.Mixpanel;

  constructor(token: string) {
    this.client = Mixpanel.init(token, {
      // Node's own batching. Set here rather than per call so a high-volume
      // event (api_error_returned) does not become one HTTP request each.
      keepAlive: true,
    });
  }

  track(event: string, distinctId: string, properties: EventProperties): void {
    // `distinct_id` goes in the properties for the Node SDK — there is no
    // separate identity argument as there is in the browser library.
    this.client.track(event, { ...properties, distinct_id: distinctId }, (error) => {
      if (error) logger.debug('mixpanel track failed', { event, error: error.message });
    });
  }

  setProfile(distinctId: string, properties: EventProperties): void {
    this.client.people.set(distinctId, toMixpanelProfile(properties), (error) => {
      if (error) logger.debug('mixpanel profile set failed', { error: error.message });
    });
  }

  incrementProfile(distinctId: string, property: string, by: number): void {
    this.client.people.increment(distinctId, property, by, (error) => {
      if (error) logger.debug('mixpanel increment failed', { error: error.message });
    });
  }

  async flush(): Promise<void> {
    // The Node SDK sends per call with keepAlive rather than holding a buffer,
    // so there is nothing to drain. Kept to satisfy the interface, and so a
    // future buffering provider has the hook it needs.
  }
}
