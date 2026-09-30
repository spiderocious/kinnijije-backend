import { model, Schema, type HydratedDocument } from 'mongoose';

/**
 * Every feature that can be switched off, and what it means when it is.
 *
 * The DESCRIPTION is part of the definition rather than living in the console,
 * because the person turning something off needs to know what breaks — and a
 * label written next to the switch drifts from the code that reads the flag.
 */
export const FEATURE_FLAGS = {
  ONBOARDING_TOUR: 'onboarding_tour',
  UPLOAD_RECEIPT: 'upload_receipt',
  UPLOAD_PHOTO: 'upload_photo',
  /**
   * The two analytics switches. Separate, because the browser and the server
   * fail and leak in different ways and you will want to stop one alone.
   *
   * Unlike every other flag here, these FAIL CLOSED — see `ANALYTICS_FLAGS`
   * below and `flags.service.ts`.
   */
  ANALYTICS_CLIENT: 'analytics_client',
  ANALYTICS_SERVER: 'analytics_server',
  /**
   * The signup invite inside the decide flow.
   *
   * An experiment, not a feature: a mid-flow interstitial converts some people
   * and loses others who would have reached a verdict. It ships behind this so
   * the trade can be measured — step-3-to-verdict completion, on versus off.
   */
  DECIDE_INVITE: 'decide_invite',
  /**
   * The Chowdeck pair. Separate, so each can be stopped alone:
   *   offers — whether a cook SEES anything from Chowdeck: the cards, and the
   *            "I'll order" choice in the decide flow
   *   fetch  — whether we CALL Chowdeck at all. Off still serves the cache, so
   *            their API can be left alone without the cards disappearing
   */
  CHOWDECK_OFFERS: 'chowdeck_offers',
  CHOWDECK_FETCH: 'chowdeck_fetch',
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * The flags that default to OFF rather than on.
 *
 * Every other flag fails open: a database blip must not strip features out of
 * the product. Analytics is the exact opposite case — "assume on" after a
 * failed read means a blip silently resumes tracking somebody switched off,
 * and if that switch was ever thrown for a privacy or legal reason, that is
 * the one behaviour that must not happen.
 *
 * The cost of this default is a few lost events at boot. The cost of the other
 * one is tracking a person you promised not to.
 */
export const FAIL_CLOSED_FLAGS: readonly FeatureFlag[] = [
  FEATURE_FLAGS.ANALYTICS_CLIENT,
  FEATURE_FLAGS.ANALYTICS_SERVER,
  /**
   * The product tour.
   *
   * It takes over the screen and navigates, and it is only ever seen ONCE —
   * so a tour shown because a flag read was slow is also a tour permanently
   * spent on somebody who was not ready for it. Off until an operator says
   * otherwise, which is what "only when the console says so" means.
   */
  FEATURE_FLAGS.ONBOARDING_TOUR,
  // An unproven experiment that can cost completions must not switch itself on
  // because a read failed. Off is the safe default until the numbers say
  // otherwise.
  FEATURE_FLAGS.DECIDE_INVITE,
  // Somebody else's API that we have no contract for. A read failure must not
  // be what starts us calling it, or what puts their name on our screens.
  FEATURE_FLAGS.CHOWDECK_OFFERS,
  FEATURE_FLAGS.CHOWDECK_FETCH,
];

export interface FlagDefinition {
  readonly key: FeatureFlag;
  readonly label: string;
  /**
   * What people GET when this is on.
   *
   * Both sentences are written about users rather than about the system, and
   * both are always shown. An operator deciding whether to throw a switch is
   * asking one question — what changes for the people using this — and the
   * honest answer is the pair, side by side.
   */
  readonly whenOn: string;
  /** What people DO NOT get when this is off. The mirror of `whenOn`. */
  readonly whenOff: string;
}

export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: FEATURE_FLAGS.ONBOARDING_TOUR,
    label: 'The product tour',
    whenOn: 'New cooks are walked through the app once, with coach marks.',
    whenOff: 'New cooks land straight on their kitchen with no coach marks.',
  },
  {
    key: FEATURE_FLAGS.UPLOAD_RECEIPT,
    label: 'Reading a market receipt',
    whenOn: 'People can photograph a market receipt and have their stock filled in from it.',
    whenOff: 'The receipt option disappears from the add-stock screen. Typing and photos still work.',
  },
  {
    key: FEATURE_FLAGS.UPLOAD_PHOTO,
    label: 'Reading a photo of a shelf',
    whenOn: 'People can photograph a shelf and have their stock filled in from it.',
    whenOff: 'The photo option disappears from the add-stock screen. Typing still works.',
  },
  {
    key: FEATURE_FLAGS.DECIDE_INVITE,
    label: 'Signup invite in the decide flow',
    whenOn:
      'Guests are offered an account once, after step three, and can dismiss it. The offer after the verdict is unaffected.',
    whenOff:
      'Nobody is asked to sign up mid-flow. The offer after the verdict is unaffected.',
  },
  {
    key: FEATURE_FLAGS.CHOWDECK_OFFERS,
    label: 'Chowdeck — offers shown to cooks',
    whenOn:
      'Cooks see Chowdeck cards, and "I\'ll order" appears as an option in the decide flow.',
    whenOff:
      'No Chowdeck cards anywhere, and "I\'ll order" disappears from the decide flow. The cache is kept.',
  },
  {
    key: FEATURE_FLAGS.CHOWDECK_FETCH,
    label: 'Chowdeck — calls to their API',
    whenOn:
      'We call Chowdeck for live prices and availability, refreshing what cooks are shown.',
    whenOff:
      'We stop calling Chowdeck entirely, including from the console. Cooks still see whatever is cached.',
  },
  {
    key: FEATURE_FLAGS.ANALYTICS_CLIENT,
    label: 'Product analytics — browser',
    whenOn:
      'The app records what people do in the browser and loads the analytics SDK. Server-side analytics is unaffected.',
    whenOff:
      'The app sends no events and loads no analytics SDK at all. Server-side analytics is unaffected.',
  },
  {
    key: FEATURE_FLAGS.ANALYTICS_SERVER,
    label: 'Product analytics — server',
    whenOn:
      'The backend records what people do, plus AI cost, error-rate and job metrics. The browser is unaffected.',
    whenOff:
      'The backend sends no events. AI cost, error-rate and job metrics stop being collected. The browser is unaffected.',
  },
];

/**
 * One switch.
 *
 * A row exists only once somebody has TOUCHED that flag — absence means ON.
 * A new flag therefore ships enabled without a migration, and turning one off
 * is an explicit, recorded act with a person's name against it.
 */
export interface FlagAttributes {
  _id: FeatureFlag;
  enabled: boolean;
  updatedBy: string | null;
  reason: string | null;
  updatedAt: Date;
}

const flagSchema = new Schema<FlagAttributes>(
  {
    _id: { type: String, required: true, enum: Object.values(FEATURE_FLAGS) },
    enabled: { type: Boolean, required: true, default: true },
    updatedBy: { type: String, default: null },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
    collection: 'feature_flags',
  },
);

export type FlagDocument = HydratedDocument<FlagAttributes>;
export const FlagModel = model<FlagAttributes>('FeatureFlag', flagSchema);
