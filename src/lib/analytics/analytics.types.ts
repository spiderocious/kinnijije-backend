/**
 * The analytics boundary.
 *
 * Nothing outside `lib/analytics` imports a vendor SDK. Every call site talks
 * to the service, which forwards to whichever providers are enabled — or to
 * none, which is a valid configuration rather than an error.
 */

/** Anything that can be a property value. No nested objects: providers flatten them inconsistently. */
export type PropertyValue = string | number | boolean | null | undefined | string[] | number[];

export type EventProperties = Record<string, PropertyValue>;

/**
 * One destination for events.
 *
 * Implemented by the Mixpanel adapter, the console adapter, and anything added
 * later. A provider is handed an event and a distinct id; mapping to whatever
 * reserved field names that vendor uses is the adapter's own business and must
 * not leak out of it.
 */
export interface AnalyticsProvider {
  readonly name: string;
  track(event: string, distinctId: string, properties: EventProperties): void;
  setProfile(distinctId: string, properties: EventProperties): void;
  incrementProfile(distinctId: string, property: string, by: number): void;
  /** Flush anything buffered. Called on shutdown; may be a no-op. */
  flush(): Promise<void>;
}
