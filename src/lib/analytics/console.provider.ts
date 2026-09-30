import { logger } from '@lib/logger/index.js';

import type { AnalyticsProvider, EventProperties } from './analytics.types.js';

/**
 * Writes events to the log instead of sending them anywhere.
 *
 * What you develop against: it makes the event stream visible without a vendor
 * account, a token, or a network call, so a wrong property name shows up in the
 * terminal rather than a week later in somebody's dashboard.
 */
export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  readonly name = 'console';

  track(event: string, distinctId: string, properties: EventProperties): void {
    logger.debug('analytics event', { event, distinct_id: distinctId, ...properties });
  }

  setProfile(distinctId: string, properties: EventProperties): void {
    logger.debug('analytics profile', { distinct_id: distinctId, ...properties });
  }

  incrementProfile(distinctId: string, property: string, by: number): void {
    logger.debug('analytics increment', { distinct_id: distinctId, property, by });
  }

  async flush(): Promise<void> {
    // Nothing is buffered — the log call is synchronous.
  }
}
