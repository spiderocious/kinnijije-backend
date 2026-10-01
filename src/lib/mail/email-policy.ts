import { stockService } from '@features/stock/stock.service.js';
import { mealsService } from '@features/meals/meals.service.js';

import {
  DEFAULT_SETTINGS,
  EmailSettingModel,
  type EligibilityRules,
  type EmailSchedule,
} from './email-settings.model.js';
import { EmailLogModel, type EmailKind } from './email-log.model.js';

/**
 * One place that answers "should this person get this email, and when".
 *
 * Both halves used to be ad hoc: the schedule was hardcoded in the sweep and
 * eligibility was a different improvised check inside each sender. That is how
 * a digest built from two stale items got sent — nobody owned the floor.
 */

export interface ResolvedSettings {
  kind: EmailKind;
  enabled: boolean;
  autoApprove: boolean;
  schedule: EmailSchedule;
  rules: EligibilityRules;
  minHoursBetween: number | null;
}

const BASE_SCHEDULE: EmailSchedule = {
  hour: 7,
  minute: 0,
  dayOfWeek: null,
  timezone: 'Africa/Lagos',
};

const BASE_RULES: EligibilityRules = {
  minStockItems: 0,
  minCookableMeals: 0,
  maxStockItems: null,
  activeWithinDays: null,
  requireOnboarded: false,
  minAccountAgeHours: 0,
};

/**
 * The effective settings for one kind.
 *
 * Layered: the base shape, then the shipped per-kind defaults, then whatever an
 * operator has actually stored. Absence still means enabled, which is the
 * convention the settings row already had — a new kind ships on without a
 * migration.
 */
export async function settingsFor(kind: EmailKind): Promise<ResolvedSettings> {
  const [row, shipped] = [
    await EmailSettingModel.findById(kind).lean().exec(),
    DEFAULT_SETTINGS[kind],
  ];

  return {
    kind,
    enabled: row?.enabled ?? true,
    autoApprove: row?.autoApprove ?? false,
    schedule: {
      ...BASE_SCHEDULE,
      ...shipped?.schedule,
      ...(row?.schedule ?? {}),
    },
    rules: {
      ...BASE_RULES,
      ...shipped?.rules,
      ...(row?.rules ?? {}),
    },
    minHoursBetween: row?.minHoursBetween ?? shipped?.minHoursBetween ?? null,
  };
}

export interface EligibilitySubject {
  readonly _id: string;
  readonly onboardingCompletedAt?: Date | null;
  readonly createdAt?: Date;
}

export type EligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Whether one person clears the floor for one kind.
 *
 * Returns the REASON on a refusal, not just false — the batch screen shows
 * "88 skipped: empty kitchen", and that count is the only feedback telling an
 * operator a rule is set wrong.
 *
 * Checks are ordered cheapest first: a field on the row before a count, a count
 * before a suggestion match that runs the matcher.
 */
export async function isEligible(
  user: EligibilitySubject,
  rules: EligibilityRules,
  kind: EmailKind,
  minHoursBetween: number | null,
): Promise<EligibilityVerdict> {
  if (rules.requireOnboarded && (user.onboardingCompletedAt ?? null) === null) {
    return { eligible: false, reason: 'not_onboarded' };
  }

  if (rules.minAccountAgeHours > 0 && user.createdAt !== undefined) {
    const ageHours = (Date.now() - user.createdAt.getTime()) / 3_600_000;
    if (ageHours < rules.minAccountAgeHours) {
      return { eligible: false, reason: 'account_too_new' };
    }
  }

  // Frequency cap, asked of the log rather than trusted to a template.
  if (minHoursBetween !== null) {
    const since = new Date(Date.now() - minHoursBetween * 3_600_000);
    const recent = await EmailLogModel.countDocuments({
      ownerId: user._id,
      kind,
      status: 'sent',
      createdAt: { $gte: since },
    }).exec();
    if (recent > 0) return { eligible: false, reason: 'sent_too_recently' };
  }

  const needsStock =
    rules.minStockItems > 0 || rules.maxStockItems !== null || rules.minCookableMeals > 0;

  if (needsStock) {
    const dashboard = await stockService.dashboard(user._id, 1);
    if (!dashboard.success) return { eligible: false, reason: 'stock_unavailable' };

    const thingsIn = dashboard.data.counts.things_in;

    if (thingsIn < rules.minStockItems) {
      return { eligible: false, reason: 'empty_kitchen' };
    }
    // The inverted rule: the empty-kitchen segment wants an empty kitchen.
    if (rules.maxStockItems !== null && thingsIn > rules.maxStockItems) {
      return { eligible: false, reason: 'kitchen_not_empty' };
    }
  }

  if (rules.minCookableMeals > 0) {
    const suggestions = await mealsService.suggest(user._id, rules.minCookableMeals);
    const cookable = suggestions.success
      ? suggestions.data.filter((s) => s.missing.length === 0).length
      : 0;
    if (cookable < rules.minCookableMeals) {
      return { eligible: false, reason: 'nothing_cookable' };
    }
  }

  if (rules.activeWithinDays !== null) {
    const { CookedMealModel } = await import('@features/meals/meals.model.js');
    const since = new Date(Date.now() - rules.activeWithinDays * 86_400_000);
    const cooked = await CookedMealModel.countDocuments({
      ownerId: user._id,
      cookedAt: { $gte: since },
    }).exec();
    if (cooked === 0) return { eligible: false, reason: 'inactive' };
  }

  return { eligible: true };
}

/**
 * The next time a schedule fires, in its own zone.
 *
 * Asks `Intl` what the wall clock currently reads in the target zone and steps
 * the UTC clock by the difference — correct across a DST boundary, unlike
 * adding a fixed offset. The server's own timezone never enters into it.
 */
export function nextRun(schedule: EmailSchedule, from: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone,
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(from);

  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '0';

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const zoneDay = Math.max(0, WEEKDAYS.indexOf(read('weekday')));
  const secondsNow = (Number(read('hour')) % 24) * 3600 + Number(read('minute')) * 60 + Number(read('second'));
  const secondsTarget = schedule.hour * 3600 + schedule.minute * 60;

  let delta = secondsTarget - secondsNow;

  if (schedule.dayOfWeek === null) {
    if (delta <= 0) delta += 86_400;
  } else {
    let daysAhead = (schedule.dayOfWeek - zoneDay + 7) % 7;
    if (daysAhead === 0 && delta <= 0) daysAhead = 7;
    delta += daysAhead * 86_400;
  }

  return new Date(from.getTime() + delta * 1000);
}
