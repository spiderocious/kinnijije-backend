import { model, Schema, type HydratedDocument } from 'mongoose';

import { EMAIL_KINDS, type EmailKind } from './email-log.model.js';

/**
 * The operator's switch for one kind of email.
 *
 * A row exists only once somebody has TOUCHED that kind — absence means
 * enabled. That way a new template ships on by default without a migration,
 * and turning something off is an explicit, recorded act.
 */
/**
 * The floor a person must clear to receive one kind of email.
 *
 * Expressed as DATA on the setting rather than code in each sender, so a new
 * kind gets the same logic and an operator can change a rule without a deploy.
 * `0` or `null` disables a check.
 */
export interface EligibilityRules {
  /** Must have at least this many things in the kitchen. */
  minStockItems: number;
  /** Must have at least this many cookable meals. */
  minCookableMeals: number;
  /**
   * INVERTED, for the empty-kitchen segment: must have at MOST this many.
   * null means no upper bound.
   */
  maxStockItems: number | null;
  /** Must have cooked within this many days. null means no requirement. */
  activeWithinDays: number | null;
  /** Skip anybody who never finished onboarding. */
  requireOnboarded: boolean;
  /** No email on day one. Hours since the account was created. */
  minAccountAgeHours: number;
}

/** When a sweep runs. A wall-clock time in a named zone, never the server's. */
export interface EmailSchedule {
  hour: number;
  minute: number;
  /** Weekly kinds only. 0 = Sunday. null means daily. */
  dayOfWeek: number | null;
  /** IANA zone, so 07:00 means 07:00 where the reader is. */
  timezone: string;
}

export interface EmailSettingAttributes {
  /** The kind is the id. One row per kind, at most. */
  _id: EmailKind;
  enabled: boolean;
  /**
   * Send without human review.
   *
   * False is the default for automated kinds: they draft into a batch somebody
   * approves. Turn it on once a kind is trustworthy — review is the right
   * default while quality is being fixed, not forever.
   */
  autoApprove: boolean;
  schedule: EmailSchedule;
  rules: EligibilityRules;
  /** At most one of this kind every N hours, per person. null = uncapped. */
  minHoursBetween: number | null;
  /** Who turned it off, and why, so nobody has to guess later. */
  updatedBy: string | null;
  reason: string | null;
  updatedAt: Date;
}

const emailSettingSchema = new Schema<EmailSettingAttributes>(
  {
    _id: { type: String, required: true, enum: Object.values(EMAIL_KINDS) },
    enabled: { type: Boolean, required: true, default: true },
    autoApprove: { type: Boolean, required: true, default: false },
    schedule: {
      hour: { type: Number, required: true, default: 7, min: 0, max: 23 },
      minute: { type: Number, required: true, default: 0, min: 0, max: 59 },
      dayOfWeek: { type: Number, default: null, min: 0, max: 6 },
      // Nigeria is the product's home, so this is the sensible default rather
      // than the server's accidental zone.
      timezone: { type: String, required: true, default: 'Africa/Lagos' },
    },
    rules: {
      minStockItems: { type: Number, required: true, default: 0 },
      minCookableMeals: { type: Number, required: true, default: 0 },
      maxStockItems: { type: Number, default: null },
      activeWithinDays: { type: Number, default: null },
      requireOnboarded: { type: Boolean, required: true, default: false },
      minAccountAgeHours: { type: Number, required: true, default: 0 },
    },
    minHoursBetween: { type: Number, default: null },
    updatedBy: { type: String, default: null },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
    collection: 'email_settings',
  },
);

export type EmailSettingDocument = HydratedDocument<EmailSettingAttributes>;
export const EmailSettingModel = model<EmailSettingAttributes>(
  'EmailSetting',
  emailSettingSchema,
);

/**
 * The shipped defaults per kind, used when no row has been touched.
 *
 * Absence means enabled — the existing convention — so these supply the rest of
 * the shape without a migration. The floors here are the ones that stop the
 * bad emails: a digest built from two stale items is worse than silence.
 */
export const DEFAULT_SETTINGS: Partial<
  Record<EmailKind, { schedule: Partial<EmailSchedule>; rules: Partial<EligibilityRules>; minHoursBetween?: number }>
> = {
  [EMAIL_KINDS.DAILY_DIGEST]: {
    schedule: { hour: 7, minute: 0, dayOfWeek: null },
    rules: { minStockItems: 3, minCookableMeals: 1, requireOnboarded: true, minAccountAgeHours: 24 },
  },
  [EMAIL_KINDS.LOW_STOCK]: {
    schedule: { hour: 9, minute: 0, dayOfWeek: null },
    rules: { minStockItems: 1, requireOnboarded: true },
    minHoursBetween: 168,
  },
  [EMAIL_KINDS.WEEKLY_SUMMARY]: {
    // Sunday evening: the week is over and the evening is quiet.
    schedule: { hour: 18, minute: 0, dayOfWeek: 0 },
    rules: { activeWithinDays: 7, requireOnboarded: true },
  },
  [EMAIL_KINDS.USE_IT_UP]: {
    schedule: { hour: 10, minute: 0, dayOfWeek: null },
    rules: { minStockItems: 1, requireOnboarded: true },
    minHoursBetween: 72,
  },
  [EMAIL_KINDS.HAVE_YOU_EATEN]: {
    schedule: { hour: 19, minute: 0, dayOfWeek: null },
    // Only somebody who has gone quiet. Otherwise it is a nag.
    rules: { requireOnboarded: true, minAccountAgeHours: 72 },
    minHoursBetween: 168,
  },
  [EMAIL_KINDS.EMPTY_KITCHEN]: {
    schedule: { hour: 11, minute: 0, dayOfWeek: 3 },
    // INVERTED: this segment is for people with nothing in.
    rules: { maxStockItems: 2, requireOnboarded: true, minAccountAgeHours: 48, activeWithinDays: 30 },
    minHoursBetween: 168,
  },
};
