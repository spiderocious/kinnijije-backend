import { createHash } from 'node:crypto';

import { env } from '@app/env.js';
import { FEATURE_FLAGS, flagsService } from '@lib/flags/index.js';
import { logger } from '@lib/logger/index.js';

import type { AnalyticsProvider, EventProperties } from './analytics.types.js';
import { ConsoleAnalyticsProvider } from './console.provider.js';
import { MixpanelProvider } from './mixpanel.provider.js';
import type { ServerEvent } from './analytics.events.js';

/**
 * The server's analytics service.
 *
 * One `track()` fans out to every configured provider. Zero providers is a
 * valid configuration — the service becomes a no-op rather than an error.
 *
 * Three rules this file exists to enforce:
 *
 *   1. Nothing here may ever throw into product code. A vendor outage, a
 *      malformed property, a provider that was never configured: all of it is
 *      swallowed and logged. Analytics may not fail a request.
 *   2. Nothing here awaits. It is called from request paths and from `catch`
 *      blocks, where an await would add latency to every response and could
 *      reorder a log line against the error it describes.
 *   3. The kill switch is checked FIRST, from cache, and an unknown answer
 *      means off.
 */

function buildProviders(): AnalyticsProvider[] {
  const out: AnalyticsProvider[] = [];

  for (const name of env.ANALYTICS_PROVIDERS) {
    switch (name) {
      case 'mixpanel': {
        if (env.MIXPANEL_TOKEN === '') {
          logger.warn('analytics: mixpanel listed but MIXPANEL_TOKEN is empty — skipping it');
          break;
        }
        out.push(new MixpanelProvider(env.MIXPANEL_TOKEN));
        break;
      }
      case 'console': {
        out.push(new ConsoleAnalyticsProvider());
        break;
      }
      default: {
        logger.warn('analytics: unknown provider in ANALYTICS_PROVIDERS, ignored', { name });
      }
    }
  }

  return out;
}

class AnalyticsService {
  private readonly providers: AnalyticsProvider[] = buildProviders();

  constructor() {
    if (this.providers.length === 0) {
      logger.info('analytics: no providers configured — every call is a no-op');
    } else {
      logger.info('analytics: providers ready', {
        providers: this.providers.map((provider) => provider.name),
      });
    }
  }

  /**
   * Whether to send at all.
   *
   * Reads the flag from cache only. `undefined` — nothing read yet, or the
   * cache has expired — is treated as OFF, which is the opposite of how every
   * other flag in this codebase behaves and is deliberate: see
   * `FAIL_CLOSED_FLAGS`. `flagsService.warm()` runs at boot so the normal case
   * is a populated cache.
   */
  private get enabled(): boolean {
    if (this.providers.length === 0) return false;
    return flagsService.cached(FEATURE_FLAGS.ANALYTICS_SERVER) === true;
  }

  /**
   * A stable-for-one-day anonymous id, for public routes with no user.
   *
   * Returns null when no salt is configured, and the caller then skips the
   * event rather than sending it under a reversible identifier.
   */
  anonymousId(ip: string): string | null {
    if (env.ANALYTICS_ANON_SALT === '') return null;

    const day = new Date().toISOString().slice(0, 10);
    const digest = createHash('sha256')
      .update(`${ip}:${env.ANALYTICS_ANON_SALT}:${day}`)
      .digest('hex')
      .slice(0, 16);

    return `anon_${digest}`;
  }

  track(event: ServerEvent, distinctId: string | null, properties: EventProperties = {}): void {
    if (!this.enabled || distinctId === null) return;

    const enriched: EventProperties = { ...properties, source: 'server', app_env: env.NODE_ENV };

    for (const provider of this.providers) {
      try {
        provider.track(event, distinctId, enriched);
      } catch (error) {
        logger.debug('analytics provider threw on track', {
          provider: provider.name,
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  setProfile(distinctId: string, properties: EventProperties): void {
    if (!this.enabled) return;

    for (const provider of this.providers) {
      try {
        provider.setProfile(distinctId, properties);
      } catch (error) {
        logger.debug('analytics provider threw on setProfile', {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  incrementProfile(distinctId: string, property: string, by = 1): void {
    if (!this.enabled) return;

    for (const provider of this.providers) {
      try {
        provider.incrementProfile(distinctId, property, by);
      } catch (error) {
        logger.debug('analytics provider threw on incrementProfile', {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Drain every provider. Called from the shutdown path. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.flush()));
  }
}

export const analytics = new AnalyticsService();
