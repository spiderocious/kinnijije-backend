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
  signOff,
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
    subject: `Welcome to KinniJije, ${who}`,
    html: shell(
      `${h(`Welcome, ${esc(who)}`)}
       ${p('I am Feranmi — I build KinniJije, and I wanted to introduce myself properly.')}
       ${p('Here is how it works. You tell me what is already in your kitchen, and I tell you what you can cook tonight. No shopping list you did not ask for, and no counting.')}
       ${p('It takes about a minute to set up. Type a few things — <b>rice</b>, <b>atarodo</b>, <b>ugwu</b> — or photograph a shelf and let me read it. A rough idea is plenty.')}
       <div style="margin:22px 0">${button('Show me what I can cook', app('/stock/add'))}</div>
       ${p('After that I will send you a short rundown each morning — what is in, what wants using, and what to make of it. You can turn that off any time.', { muted: true })}
       ${p('If anything is confusing or broken, reply to this email. It comes to me.', { muted: true })}
       ${signOff('Glad to have you,')}`,
      MANAGE,
    ),
    text: `Welcome, ${who}.

I am Feranmi — I build KinniJije, and I wanted to introduce myself properly.

Here is how it works. You tell me what is already in your kitchen, and I tell you what you can cook tonight. No shopping list you did not ask for, and no counting.

It takes about a minute to set up. Type a few things — rice, atarodo, ugwu — or photograph a shelf and let me read it. A rough idea is plenty.

Start here: ${app('/stock/add')}

After that I will send you a short rundown each morning. You can turn that off any time.

If anything is confusing or broken, reply to this email. It comes to me.

Glad to have you,
Feranmi
KinniJije`,
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
    subject: 'Setting a new password',
    html: shell(
      `${h('Setting a new password')}
       ${p(`Hello ${esc(who)},`)}
       ${p('Somebody asked to reset the password on this account. If that was you, the button below sets a new one.')}
       <div style="margin:22px 0">${button('Choose a new password', href)}</div>
       ${p('The link works once and stops working after an hour. Using it signs out everything you are currently signed in on, which puts out anybody who should not be there.')}
       ${p('If this was not you, nothing has changed and you can ignore this. Nobody can get in with the old password either way.', { muted: true })}
       ${signOff('Kind regards,')}`,
    ),
    text: `Setting a new password

Hello ${who},

Somebody asked to reset the password on this account. If that was you, open this link to choose a new one:

${href}

It works once and stops working after an hour. Using it signs out everything you are currently signed in on, which puts out anybody who should not be there.

If this was not you, nothing has changed and you can ignore this.

Kind regards,
Feranmi
KinniJije`,
  };
};

export const passwordChangedEmail = (name: string | null): EmailContent => {
  const who = firstName(name);
  return {
    subject: 'Your password was just changed',
    html: shell(
      `${h('Your password was changed')}
       ${p(`Hello ${esc(who)},`)}
       ${p('The password on your account was changed a moment ago, and everything else that was signed in has been signed out. If that was you, there is nothing to do.')}
       ${p('If it was NOT you, reset it now — that will lock out whoever did it.')}
       <div style="margin:22px 0">${button('Reset my password', app('/forgot-password'))}</div>
       ${p('Either way, you can reply to this email and it comes to me.', { muted: true })}
       ${signOff('Kind regards,')}`,
    ),
    text: `Your password was changed

Hello ${who},

The password on your account was changed a moment ago, and everything else that was signed in has been signed out. If that was you, there is nothing to do.

If it was NOT you, reset it now — that will lock out whoever did it:
${app('/forgot-password')}

Either way, you can reply to this email and it comes to me.

Kind regards,
Feranmi
KinniJije`,
  };
};

export const statusChangedEmail = (
  name: string | null,
  status: string,
  reason?: string,
): EmailContent => {
  const who = firstName(name);
  return {
    subject: `A change to your KinniJije account`,
    html: shell(
      `${h('A change to your account')}
       ${p(`Hello ${esc(who)},`)}
       ${p(`I am writing to let you know your account is now <b>${esc(status)}</b>.`)}
       ${reason === undefined ? '' : p(`The reason given was: ${esc(reason)}`)}
       ${p('If you think that is wrong, reply to this email and I will read it myself. There is a person at this end.')}
       ${signOff('Kind regards,')}`,
    ),
    text: `A change to your account

Hello ${who},

I am writing to let you know your account is now ${status}.${reason === undefined ? '' : `\n\nThe reason given was: ${reason}`}

If you think that is wrong, reply to this email and I will read it myself. There is a person at this end.

Kind regards,
Feranmi
KinniJije`,
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

  return {
    subject:
      blocking.length > 0
        ? `You are out of what ${blocking[0] ?? 'a favourite'} needs`
        : 'A few things worth picking up',
    html: shell(
      `${h('Worth picking up')}
       ${p(`Hello ${esc(who)},`)}
       ${p('I noticed a few things in your kitchen have run down. These are the ones standing between you and something you cook.')}
       ${list(items.map((item) => `<b>${esc(item.name)}</b> — ${esc(item.reason)}`))}
       ${
         blocking.length > 0
           ? p(
               `Between them, they are what is stopping ${blocking
                 .map((meal) => `<b>${esc(meal)}</b>`)
                 .join(' and ')}.`,
             )
           : ''
       }
       ${p('One tap puts them on your list.')}
       <div style="margin:22px 0">${button('Put them on my list', app('/market'))}</div>
       ${p('When you get back from the market, tick them off and they land in your kitchen on their own. You never have to count anything.', { muted: true })}
       ${signOff('Bye for now,')}`,
      MANAGE,
    ),
    text: `Worth picking up

Hello ${who},

I noticed a few things in your kitchen have run down:

${items.map((item) => `  • ${item.name} — ${item.reason}`).join('\n')}
${blocking.length > 0 ? `\nBetween them, they are what is stopping ${blocking.join(' and ')}.` : ''}

One tap puts them on your list:
${app('/market')}

When you get back, tick them off and they land in your kitchen on their own.

Bye for now,
Feranmi
KinniJije`,
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
        ? 'Something wants using'
        : `The ${soonest.name} wants using`,
    html: shell(
      `${h('These want using first')}
       ${p(`Hello ${esc(who)},`)}
       ${p('A few things in your kitchen are near the end of their good days, and there is still something good to do with them.')}
       ${list(
         items.map(
           (item) =>
             `<b>${esc(item.name)}</b> — ${item.daysLeft <= 0 ? 'today, really' : `about ${String(item.daysLeft)} day${item.daysLeft === 1 ? '' : 's'} left`}`,
         ),
       )}
       ${p('Here is what you could make with them, using what you already have:')}
       ${meals
         .map((meal) =>
           card({
             title: meal.name,
             body: `Uses ${meal.uses.map((use) => esc(use)).join(', ')}.`,
             accent: SUCCESS,
           }),
         )
         .join('')}
       <div style="margin:22px 0">${button('Open my kitchen', app('/suggestions'))}</div>
       ${signOff('Bye for now,')}`,
      MANAGE,
    ),
    text: `These want using first

Hello ${who},

A few things in your kitchen are near the end of their good days:

${items.map((item) => `  • ${item.name} — ${item.daysLeft <= 0 ? 'today, really' : `about ${String(item.daysLeft)} days left`}`).join('\n')}

Here is what you could make with them, using what you already have:
${meals.map((meal) => `  • ${meal.name} — uses ${meal.uses.join(', ')}`).join('\n')}

${app('/suggestions')}

Bye for now,
Feranmi
KinniJije`,
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
  const total = data.breakfast.length + data.lunch.length + data.dinner.length;

  /**
   * The weather, as a person would say it.
   *
   * "31°C in Lagos, up to 33°, down to 26°" is a readout. "It should sit around
   * 31° in Lagos today, climbing to 33" is somebody telling you about the day.
   */
  const weatherSentence = (): string => {
    if (data.weather === null) return '';
    const w = data.weather;
    const range =
      w.high === null
        ? ''
        : w.rain
          ? ` It climbs to about ${String(w.high)}° and drops to ${String(w.low ?? 0)}°, and there is rain about — worth planning something you do not have to leave the house for.`
          : ` It climbs to about ${String(w.high)}° and drops back to ${String(w.low ?? 0)}° tonight.`;
    return p(`${esc(w.summary)} today.${range}`);
  };

  const expiring =
    data.expiringToday.length === 0
      ? ''
      : `${p(
          data.expiringToday.length === 1
            ? `One thing wants using today — the <b>${esc(data.expiringToday[0]?.name ?? '')}</b>. I have kept that in mind below.`
            : `a few things worth using today: ${data.expiringToday
                .map((item) => `<b>${esc(item.name)}</b>`)
                .join(', ')}. I have kept those in mind below.`,
        )}`;

  return {
    subject: `Your day rundown, ${who}`,
    html: shell(
      `${h('Your day rundown')}
       ${p(`Good morning ${esc(who)},`)}
       ${p(esc(data.intro))}
       ${weatherSentence()}
       ${expiring}

       ${p(
         total === 0
           ? 'I could not find much to suggest from what is in your kitchen this morning — add a few more things and this fills out fast.'
           : `I have put together <b>${String(total)}</b> suggestion${total === 1 ? '' : 's'} across the day, picked from what is <em>actually</em> in your kitchen right now. Anything needing a shop says so. Tap any of them to see how it is made.`,
       )}

       ${slot('For breakfast', data.breakfast)}
       ${slot('For lunch', data.lunch)}
       ${slot('For dinner', data.dinner)}

       ${data.closing === null ? '' : p(esc(data.closing))}
       ${p('If none of it appeals, open the app and ask me for something else.', { muted: true })}
       <div style="margin:22px 0">${button('Open my kitchen', app('/kitchen'))}</div>
       ${signOff('Have a good one,')}`,
      MANAGE,
    ),
    text: `Your day rundown

Good morning ${who},

${data.intro}
${data.weather === null ? '' : `\n${data.weather.summary} today.`}
${
  data.expiringToday.length > 0
    ? `\nWanting used today: ${data.expiringToday.map((item) => item.name).join(', ')}.`
    : ''
}

${
  total === 0
    ? 'I could not find much to suggest from what is in your kitchen this morning.'
    : `I have put together ${String(total)} suggestions across the day, picked from what is actually in your kitchen right now.`
}
${textSlot('For breakfast', data.breakfast)}${textSlot('For lunch', data.lunch)}${textSlot('For dinner', data.dinner)}
${data.closing ?? ''}
If none of it appeals, open the app and ask me for something else.
${app('/kitchen')}

Have a good one,
Feranmi
KinniJije`,
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
    subject: data.cooked > 0 ? `Your week — ${String(data.cooked)} meals` : 'Your week',
    html: shell(
      `${h('Your week')}
       ${p(`Hello ${esc(who)},`)}
       ${
         data.cooked > 0
           ? `${p(`You cooked <b>${String(data.cooked)}</b> time${data.cooked === 1 ? '' : 's'} this week. Here is what came out of your kitchen:`)}
              ${data.meals.length > 0 ? list(data.meals.map((meal) => esc(meal))) : ''}`
           : p('Nothing was cooked through the app this week — which is only what I can see from here. No judgement either way.')
       }
       ${data.reading === null ? '' : p(esc(data.reading))}
       ${
         data.spent === null
           ? ''
           : p(`Roughly ₦${data.spent.toLocaleString()} went through the market list, give or take — those are estimates.`, { muted: true })
       }
       <div style="margin:22px 0">${button('See the whole week', app('/week'))}</div>
       ${p('No streak to keep, nothing to catch up on. This is just a note.', { muted: true })}
       ${signOff('Bye for now,')}`,
      MANAGE,
    ),
    text: `Your week

Hello ${who},

${data.cooked > 0 ? `You cooked ${String(data.cooked)} times this week:\n${data.meals.map((m) => `  • ${m}`).join('\n')}` : 'Nothing was cooked through the app this week — which is only what I can see from here.'}

${data.reading ?? ''}
${data.spent === null ? '' : `Roughly ₦${data.spent.toLocaleString()} went through the market list — estimates.`}

${app('/week')}

No streak to keep, nothing to catch up on.

Bye for now,
Feranmi
KinniJije`,
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
       ${p(`Hello ${esc(who)},`)}
       ${p('That is the whole question. No streak to keep, nothing to catch up on, and no lecture coming.')}
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
           : p('Your kitchen is looking empty from here — which is its own kind of answer.')
       }
       <div style="margin:22px 0">${button('Open KinniJije', app('/kitchen'))}</div>
       ${signOff('Take care,')}`,
      MANAGE,
    ),
    text: `Have you eaten?

Hello ${who},

That is the whole question. No streak to keep, nothing to catch up on, and no lecture coming.

${quickest.length > 0 ? `The fastest things your kitchen can manage right now:\n${quickest.map((m) => `  • ${m.name} — about ${String(m.minutes)} minutes`).join('\n')}` : 'Your kitchen is looking empty from here — which is its own kind of answer.'}

${app('/kitchen')}

Take care,
Feranmi
KinniJije`,
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
       ${p(`Hello ${esc(who)},`)}
       ${bodyLines.map((line) => p(esc(line))).join('')}
       ${p('As always, you can reply to this and it comes to me.', { muted: true })}
       ${signOff('Bye for now,')}`,
      MANAGE,
    ),
    text: `${subject}

Hello ${who},

${bodyLines.join('\n\n')}

As always, you can reply to this and it comes to me.

Bye for now,
Feranmi
KinniJije`,
  };
};
