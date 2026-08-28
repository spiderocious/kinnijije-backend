import { env } from '@app/env.js';

import {
  button,
  card,
  CAUTION,
  esc,
  FONT_STACK,
  h,
  INK,
  INK_2,
  INK_3,
  list,
  p,
  shell,
  SKY,
  SUCCESS,
} from './components.js';

/**
 * Email copy lives here, beside the message registry in spirit: not inline at
 * a callsite where it cannot be reviewed as copy.
 *
 * Every template has a matching design-system spec, noted above it. The rules
 * on those specs are not decoration — "a question, not a reprimand" is the
 * difference between an email that works and one that gets unsubscribed.
 */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * A link into the web app.
 *
 * The trailing slash is stripped because APP_URL is written by hand and
 * "https://kinnijije.xyz/" is at least as natural to type as the bare form —
 * without this every link in every email would be a double slash.
 */
const app = (path: string): string => `${env.APP_URL.replace(/\/+$/, '')}${path}`;
const MANAGE = app('/settings');

/** A name we can address somebody by, without "Hi null". */
const firstName = (name: string | null): string => {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return 'there';
  return trimmed.split(' ')[0] ?? 'there';
};

// ── 384 · Welcome ────────────────────────────────────────────────────
/**
 * Spec 384. ONE job: get them to the first suggestion. No feature tour, no
 * six-step onboarding — the product proves itself in sixty seconds or not
 * at all.
 */
export const welcomeEmail = (name: string | null): EmailContent => {
  const who = firstName(name);
  return {
    subject: 'Your kitchen is ready',
    html: shell(
      `${h(`Welcome, ${esc(who)}`)}
       ${p('KinniJije works the other way round from a recipe site. You do not start with a dish and go shopping — you tell us what is already in your kitchen, and we tell you what you can cook tonight.')}
       ${p('It takes about a minute. Type a few things — <b>rice</b>, <b>atarodo</b>, <b>ugwu</b> — or photograph a shelf and let us read it.')}
       <div style="margin:22px 0">${button('Show me what I can cook', app('/stock/add'))}</div>
       ${p('You do not have to be exhaustive, and you never have to count anything. The kitchen fills itself as you cook and shop.', { muted: true })}`,
      // The footer link matters here: a welcome email with no way out reads as
      // bulk to a filter, whatever we think it is.
      MANAGE,
    ),
    text: `Welcome, ${who}.

KinniJije works the other way round from a recipe site. You do not start with a dish and go shopping — you tell us what is already in your kitchen, and we tell you what you can cook tonight.

It takes about a minute. Type a few things — rice, atarodo, ugwu — or photograph a shelf and let us read it.

Start here: ${app('/stock/add')}

You do not have to be exhaustive, and you never have to count anything.`,
  };
};

// ── Password reset ───────────────────────────────────────────────────
/**
 * Transactional, so it carries no unsubscribe link — somebody who asked to
 * reset their password has not opted into anything, they have made a request.
 */
export const passwordResetEmail = (name: string | null, token: string): EmailContent => {
  const who = firstName(name);
  const href = app(`/reset-password?token=${encodeURIComponent(token)}`);
  return {
    subject: 'Reset your KinniJije password',
    html: shell(
      `${h('Set a new password')}
       ${p(`Hi ${esc(who)} — somebody asked to reset the password on this account. If that was you, the link below will let you choose a new one.`)}
       <div style="margin:22px 0">${button('Choose a new password', href)}</div>
       ${p('This link works once and expires in an hour. Everything you are signed in on will be signed out when you use it.', { muted: true })}
       ${p('If you did not ask for this, nothing has changed and you can ignore this email.', { muted: true })}`,
    ),
    text: `Hi ${who},

Somebody asked to reset the password on this account. If that was you, open this link to choose a new one:

${href}

It works once and expires in an hour. Everything you are signed in on will be signed out when you use it.

If you did not ask for this, nothing has changed and you can ignore this email.`,
  };
};

export const passwordChangedEmail = (name: string | null): EmailContent => {
  const who = firstName(name);
  return {
    subject: 'Your KinniJije password was changed',
    html: shell(
      `${h('Password changed')}
       ${p(`Hi ${esc(who)} — the password on your account was just changed, and every other signed-in device was signed out.`)}
       ${p('If this was not you, reset your password now and it will lock everyone else out.')}
       <div style="margin:22px 0">${button('Reset my password', app('/forgot-password'))}</div>`,
    ),
    text: `Hi ${who}, the password on your account was just changed and every other device was signed out.

If this was not you, reset it now: ${app('/forgot-password')}`,
  };
};

export const statusChangedEmail = (
  name: string | null,
  status: string,
  reason?: string,
): EmailContent => {
  const who = firstName(name);
  return {
    subject: `Your KinniJije account is now ${status}`,
    html: shell(
      `${h('Your account has changed')}
       ${p(`Hi ${esc(who)} — your account is now <b>${esc(status)}</b>.`)}
       ${reason === undefined ? '' : p(`Reason given: ${esc(reason)}`)}
       ${p('If you think this is a mistake, reply to this email and a person will read it.', { muted: true })}`,
    ),
    text: `Hi ${who}, your account is now ${status}.${reason === undefined ? '' : `\n\nReason given: ${reason}`}\n\nIf you think this is a mistake, reply to this email and a person will read it.`,
  };
};

// ── 380 · Running low ────────────────────────────────────────────────
export interface LowStockItem {
  name: string;
  reason: string;
}

/**
 * Spec 380. Sent at most weekly, and ONLY when something is genuinely blocking
 * a meal the cook makes often. A low-stock email about a spice they use twice a
 * year is how an inbox learns to ignore you — the gate is in the service, not
 * here, but it is the reason this template exists at all.
 */
export const lowStockEmail = (
  name: string | null,
  items: readonly LowStockItem[],
  blocking: readonly string[],
): EmailContent => {
  const who = firstName(name);
  const names = items.map((item) => item.name);

  return {
    subject:
      blocking.length > 0
        ? `You are out of what ${blocking[0] ?? 'a favourite'} needs`
        : 'A few things are running low',
    html: shell(
      `${h('Worth picking up')}
       ${p(`Hi ${esc(who)} — these are running low or finished:`)}
       ${list(items.map((item) => `<b>${esc(item.name)}</b> — ${esc(item.reason)}`))}
       ${
         blocking.length > 0
           ? p(
               `Between them they are what is standing between you and ${blocking
                 .map((meal) => `<b>${esc(meal)}</b>`)
                 .join(', ')}.`,
             )
           : ''
       }
       <div style="margin:22px 0">${button('Put them on my list', app('/market'))}</div>
       ${p('Tick something off after you shop and it lands in your kitchen — you never have to count anything.', { muted: true })}`,
      MANAGE,
    ),
    text: `Hi ${who}, these are running low or finished:

${items.map((item) => `• ${item.name} — ${item.reason}`).join('\n')}
${blocking.length > 0 ? `\nBetween them they are what is standing between you and ${blocking.join(', ')}.` : ''}

Put them on your list: ${app('/market')}

Names: ${names.join(', ')}`,
  };
};

// ── 383 · Use it up ──────────────────────────────────────────────────
export interface ExpiringItem {
  name: string;
  daysLeft: number;
}

/**
 * Spec 383. Sent ONLY when there is something to do about it — an email that
 * says food is about to spoil and offers no meal is just bad news. The caller
 * must not send this with an empty `meals`.
 */
export const useItUpEmail = (
  name: string | null,
  items: readonly ExpiringItem[],
  meals: readonly { id: string; name: string; uses: string[] }[],
): EmailContent => {
  const who = firstName(name);
  const soonest = items[0];

  return {
    subject:
      soonest === undefined
        ? 'Something needs using'
        : `Use the ${soonest.name} in the next ${String(Math.max(1, soonest.daysLeft))} day${soonest.daysLeft === 1 ? '' : 's'}`,
    html: shell(
      `${h('These want using first')}
       ${p(`Hi ${esc(who)} — nothing dramatic, but a few things in your kitchen are near the end of their good days:`)}
       ${list(
         items.map(
           (item) =>
             `<b>${esc(item.name)}</b> — ${item.daysLeft <= 0 ? 'today' : `about ${String(item.daysLeft)} day${item.daysLeft === 1 ? '' : 's'} left`}`,
         ),
       )}
       ${p('You can cook any of these with what you already have:')}
       ${meals
         .map((meal) =>
           card({
             title: meal.name,
             body: `Uses ${meal.uses.map((use) => esc(use)).join(', ')}.`,
             accent: SUCCESS,
           }),
         )
         .join('')}
       <div style="margin:22px 0">${button('Open my kitchen', app('/suggestions'))}</div>`,
      MANAGE,
    ),
    text: `Hi ${who}, a few things in your kitchen are near the end of their good days:

${items.map((item) => `• ${item.name} — ${item.daysLeft <= 0 ? 'today' : `about ${String(item.daysLeft)} days left`}`).join('\n')}

You can cook any of these with what you already have:
${meals.map((meal) => `• ${meal.name} — uses ${meal.uses.join(', ')}`).join('\n')}

${app('/suggestions')}`,
  };
};

/** One meal in the rundown — a clickable card with its reason underneath. */
interface RundownMealView {
  id: string;
  name: string;
  minutes: number;
  reason: string;
  missing: number;
}

function mealBlock(meal: RundownMealView): string {
  const href = app(`/meals/${meal.id}`);
  const meta =
    meal.missing === 0
      ? `${String(meal.minutes)} min · you have everything`
      : `${String(meal.minutes)} min · ${String(meal.missing)} to get`;

  // The whole card is the link. In an email a tappable card has to be an
  // anchor — there is no JavaScript to catch a click on a div.
  return `<a href="${href}" style="display:block;text-decoration:none;margin:0 0 10px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${INK};border-radius:18px 5px 18px 5px;overflow:hidden">
      <tr><td style="background:${meal.missing === 0 ? SUCCESS : SKY};height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>
      <tr><td style="padding:13px 15px;font-family:${FONT_STACK}">
        <p style="margin:0;font-weight:800;font-size:16px;color:${INK}">${esc(meal.name)}</p>
        <p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:${INK_2}">${esc(meal.reason)}</p>
        <p style="margin:6px 0 0;font-size:12px;color:${INK_3}">${meta}</p>
      </td></tr>
    </table>
  </a>`;
}

/** The plain-text half of a slot. Empty string when the slot has nothing. */
function textSlot(title: string, meals: readonly RundownMealView[]): string {
  if (meals.length === 0) return '';
  const lines = meals
    .map(
      (meal) =>
        `  • ${meal.name} (${String(meal.minutes)} min) — ${meal.reason}\n    ${app(`/meals/${meal.id}`)}`,
    )
    .join('\n');
  return `\n${title}:\n${lines}\n`;
}

function slot(title: string, meals: readonly RundownMealView[]): string {
  if (meals.length === 0) return '';
  return `<p style="margin:18px 0 8px;font-family:${FONT_STACK};font-weight:800;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${INK_3}">${esc(title)}</p>
    ${meals.map(mealBlock).join('')}`;
}

/**
 * The daily rundown.
 *
 * What is going off today, what the day looks like outside, and what to eat at
 * each of the three times — every meal a link straight into its recipe.
 *
 * The meals were chosen by the matcher; the reasons were written by a model
 * that could only see the shortlist. See `rundown.service.ts`.
 */
export const dailyRundownEmail = (
  name: string | null,
  data: {
    readonly intro: string;
    readonly closing: string | null;
    readonly weather: { summary: string; high: number | null; low: number | null; rain: boolean } | null;
    readonly expiringToday: readonly { name: string; daysLeft: number }[];
    readonly breakfast: readonly RundownMealView[];
    readonly lunch: readonly RundownMealView[];
    readonly dinner: readonly RundownMealView[];
  },
): EmailContent => {
  const who = firstName(name);
  const first = data.dinner[0] ?? data.lunch[0] ?? data.breakfast[0];

  const weatherLine =
    data.weather === null
      ? ''
      : p(
          `<b>${esc(data.weather.summary)}</b>${
            data.weather.high === null
              ? ''
              : ` — up to ${String(data.weather.high)}°, down to ${String(data.weather.low ?? 0)}°${data.weather.rain ? ', with rain about' : ''}`
          }.`,
        );

  const expiring =
    data.expiringToday.length === 0
      ? ''
      : `${p('<b>Going off today</b>')}
         ${list(
           data.expiringToday.map(
             (item) =>
               `${esc(item.name)}${item.daysLeft <= 0 ? ' — already past its day' : ''}`,
           ),
         )}`;

  return {
    subject: first === undefined ? 'Your day' : `Today: ${first.name}`,
    html: shell(
      `${h(`Morning, ${esc(who)}`)}
       ${p(esc(data.intro))}
       ${weatherLine}
       ${expiring}
       ${slot('Breakfast', data.breakfast)}
       ${slot('Lunch', data.lunch)}
       ${slot('Dinner', data.dinner)}
       ${data.closing === null ? '' : p(esc(data.closing), { muted: true })}
       <div style="margin:22px 0">${button('Open my kitchen', app('/kitchen'))}</div>`,
      MANAGE,
    ),
    text: `Morning ${who}.

${data.intro}
${data.weather === null ? '' : `\n${data.weather.summary}.`}
${
  data.expiringToday.length > 0
    ? `\nGoing off today: ${data.expiringToday.map((item) => item.name).join(', ')}`
    : ''
}

${textSlot('Breakfast', data.breakfast)}${textSlot('Lunch', data.lunch)}${textSlot('Dinner', data.dinner)}
${data.closing ?? ''}
${app('/kitchen')}`,
  };
};

// ── 382 · Your week ──────────────────────────────────────────────────
/**
 * Spec 382. The one scheduled email. DESCRIPTIVE, never a scorecard — it
 * reports the week the way the in-app summary does, and it LINKS rather than
 * duplicating. No streaks, no targets, no "you only cooked twice".
 */
export const weeklySummaryEmail = (
  name: string | null,
  data: {
    readonly cooked: number;
    readonly meals: readonly string[];
    readonly reading: string | null;
    readonly spent: number | null;
  },
): EmailContent => {
  const who = firstName(name);

  return {
    subject: data.cooked > 0 ? `You cooked ${String(data.cooked)} times this week` : 'Your week',
    html: shell(
      `${h('Your week')}
       ${
         data.cooked > 0
           ? `${p(`Hi ${esc(who)} — you cooked <b>${String(data.cooked)}</b> time${data.cooked === 1 ? '' : 's'} this week.`)}
              ${data.meals.length > 0 ? list(data.meals.map((meal) => esc(meal))) : ''}`
           : p(`Hi ${esc(who)} — nothing was cooked from the app this week. That is only what we can see, not what you ate.`)
       }
       ${data.reading === null ? '' : p(esc(data.reading))}
       ${
         data.spent === null
           ? ''
           : p(`Roughly ₦${data.spent.toLocaleString()} went on the market list.`, { muted: true })
       }
       <div style="margin:22px 0">${button('See the whole week', app('/week'))}</div>`,
      MANAGE,
    ),
    text: `Hi ${who},

${data.cooked > 0 ? `You cooked ${String(data.cooked)} times this week.\n${data.meals.map((m) => `• ${m}`).join('\n')}` : 'Nothing was cooked from the app this week. That is only what we can see, not what you ate.'}

${data.reading ?? ''}
${data.spent === null ? '' : `Roughly ₦${data.spent.toLocaleString()} went on the market list.`}

${app('/week')}`,
  };
};

// ── 381 · Have you eaten? ────────────────────────────────────────────
/**
 * Spec 381. The hardest email in the product to get right. It is a QUESTION,
 * not a reprimand — people stop cooking for reasons that are none of the
 * product's business, and an email that implies failure is one that gets
 * unsubscribed.
 *
 * So: no counting of days, no "we noticed you have not", no encouragement.
 */
export const haveYouEatenEmail = (
  name: string | null,
  quickest: readonly { id: string; name: string; minutes: number }[],
): EmailContent => {
  const who = firstName(name);

  return {
    subject: 'Have you eaten?',
    html: shell(
      `${h('Have you eaten?')}
       ${p(`Hi ${esc(who)} — that is the whole question. No streak to keep, nothing to catch up on.`)}
       ${
         quickest.length > 0
           ? `${p('If it helps, these are the fastest things your kitchen can manage right now:')}
              ${quickest
                .map((meal) =>
                  card({
                    title: meal.name,
                    body: `About ${String(meal.minutes)} minutes.`,
                    accent: CAUTION,
                  }),
                )
                .join('')}`
           : p('Your kitchen is looking empty — which is its own kind of answer.')
       }
       <div style="margin:22px 0">${button('Open KinniJije', app('/kitchen'))}</div>`,
      MANAGE,
    ),
    text: `Hi ${who}, have you eaten? That is the whole question. No streak to keep, nothing to catch up on.

${quickest.length > 0 ? `The fastest things your kitchen can manage right now:\n${quickest.map((m) => `• ${m.name} — about ${String(m.minutes)} minutes`).join('\n')}` : 'Your kitchen is looking empty — which is its own kind of answer.'}

${app('/kitchen')}`,
  };
};

// ── Admin-composed ───────────────────────────────────────────────────
/**
 * Whatever an operator wrote.
 *
 * The body is admin-authored, so it is placed as HTML — but every value that
 * came from anywhere else is escaped, and the frame is the same as every other
 * email so it cannot be mistaken for a different sender.
 */
export const adminBroadcastEmail = (
  name: string | null,
  subject: string,
  bodyLines: readonly string[],
): EmailContent => {
  const who = firstName(name);

  return {
    subject,
    html: shell(
      `${h(subject)}
       ${p(`Hi ${esc(who)},`)}
       ${bodyLines.map((line) => p(esc(line))).join('')}`,
      MANAGE,
    ),
    text: `Hi ${who},\n\n${bodyLines.join('\n\n')}`,
  };
};
