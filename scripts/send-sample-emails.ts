/**
 * Sends one of EVERY email to a set of addresses, so the whole set can be
 * looked at side by side in a real inbox.
 *
 *   pnpm email:samples
 *
 * Real sends against real Resend. The content is made up — plausible-looking
 * kitchens rather than anybody's actual data — but the rendering, the frame and
 * the links are exactly what a real send produces.
 *
 * Every one is recorded in the email log like any other, so they also show up
 * at /admin/emails.
 */
import { connectDatabase, disconnectDatabase } from '../src/lib/db/connection.js';
import { EMAIL_KINDS, emailService } from '../src/lib/mail/index.js';
import {
  adminBroadcastEmail,
  dailyRundownEmail,
  haveYouEatenEmail,
  lowStockEmail,
  passwordChangedEmail,
  passwordResetEmail,
  statusChangedEmail,
  useItUpEmail,
  weeklySummaryEmail,
  welcomeEmail,
} from '../src/lib/mail/templates.js';

const RECIPIENTS = ['devferanmi@gmail.com', 'feranmidev@gmail.com'];

/** A believable kitchen, so the templates are shown doing real work. */
const NAME = 'Feranmi';

const SAMPLES = [
  {
    kind: EMAIL_KINDS.WELCOME,
    label: '384 · welcome',
    content: () => welcomeEmail(NAME),
  },
  {
    kind: EMAIL_KINDS.PASSWORD_RESET,
    label: 'password reset',
    // A fake token — the link is shaped right but will not resolve.
    content: () => passwordResetEmail(NAME, 'SAMPLE-TOKEN-not-a-real-one-0123456789abcdef'),
  },
  {
    kind: EMAIL_KINDS.PASSWORD_CHANGED,
    label: 'password changed',
    content: () => passwordChangedEmail(NAME),
  },
  {
    kind: EMAIL_KINDS.STATUS_CHANGED,
    label: 'account status',
    content: () => statusChangedEmail(NAME, 'suspended', 'A sample, not a real decision.'),
  },
  {
    kind: EMAIL_KINDS.DAILY_DIGEST,
    label: 'daily · the rundown',
    content: () =>
      dailyRundownEmail(NAME, {
        intro:
          'Warm one today, and the ugwu is on its last day — worth building the afternoon around it.',
        closing: null,
        weather: { summary: '31°C in Lagos', high: 33, low: 26, rain: false },
        expiringToday: [
          { name: 'Ugwu', daysLeft: 0 },
          { name: 'Tomatoes', daysLeft: 1 },
        ],
        breakfast: [
          {
            id: 'meal_sample_b1',
            name: 'Akara and pap',
            minutes: 20,
            reason: 'Light enough for the heat, and the beans are already soaked.',
            missing: 0,
          },
          {
            id: 'meal_sample_b2',
            name: 'Yam and egg sauce',
            minutes: 25,
            reason: 'Uses the tomatoes before they turn.',
            missing: 1,
          },
        ],
        lunch: [
          {
            id: 'meal_sample_l1',
            name: 'Efo riro',
            minutes: 40,
            reason: 'The ugwu goes today, and this is what it is for.',
            missing: 0,
          },
          {
            id: 'meal_sample_l2',
            name: 'Jollof rice',
            minutes: 45,
            reason: 'You have everything, and it keeps for the evening.',
            missing: 0,
          },
        ],
        dinner: [
          {
            id: 'meal_sample_d1',
            name: 'Asaro',
            minutes: 45,
            reason: 'Soft food after a hot day, and the yam is going soft anyway.',
            missing: 0,
          },
          {
            id: 'meal_sample_d2',
            name: 'Egusi soup',
            minutes: 70,
            reason: 'Worth it if you have the evening — nothing else uses the stockfish.',
            missing: 2,
          },
        ],
      }),
  },
  {
    kind: EMAIL_KINDS.WEEKLY_SUMMARY,
    label: '382 · your week',
    content: () =>
      weeklySummaryEmail(NAME, {
        cooked: 5,
        meals: ['Jollof rice', 'Efo riro', 'Asaro', 'Beans and plantain', 'Egusi'],
        reading: 'You cooked more from the freezer than the shelf this week.',
        spent: 18500,
      }),
  },
  {
    kind: EMAIL_KINDS.LOW_STOCK,
    label: '380 · running low',
    content: () =>
      lowStockEmail(
        NAME,
        [
          { name: 'Palm oil', reason: 'finished on Tuesday' },
          { name: 'Stock cubes', reason: 'down to the last two' },
          { name: 'Crayfish', reason: 'nearly out' },
        ],
        ['Efo riro', 'Egusi soup'],
      ),
  },
  {
    kind: EMAIL_KINDS.USE_IT_UP,
    label: '383 · use it up',
    content: () =>
      useItUpEmail(
        NAME,
        [
          { name: 'Ugwu', daysLeft: 1 },
          { name: 'Tomatoes', daysLeft: 2 },
        ],
        [
          { id: 'meal_sample_3', name: 'Efo riro', uses: ['Ugwu', 'Palm oil'] },
          { id: 'meal_sample_4', name: 'Stew', uses: ['Tomatoes', 'Onions'] },
        ],
      ),
  },
  {
    kind: EMAIL_KINDS.HAVE_YOU_EATEN,
    label: '381 · have you eaten?',
    content: () =>
      haveYouEatenEmail(NAME, [
        { id: 'meal_sample_5', name: 'Indomie and egg', minutes: 8 },
        { id: 'meal_sample_6', name: 'Yam and sauce', minutes: 25 },
      ]),
  },
  {
    kind: EMAIL_KINDS.ADMIN_BROADCAST,
    label: 'from an operator',
    content: () =>
      adminBroadcastEmail(NAME, 'A small change to suggestions', [
        'We changed how meals are ranked this week. Anything you can cook outright now sorts above anything needing a shop, which sounds obvious and somehow was not the case before.',
        'Nothing you have entered has moved, and no settings changed.',
      ]),
  },
];

async function main(): Promise<void> {
  await connectDatabase();

  let sent = 0;
  let failed = 0;

  for (const to of RECIPIENTS) {
    for (const sample of SAMPLES) {
      const result = await emailService.send({
        kind: sample.kind,
        to,
        // No owner: these are samples, not mail to an account.
        ownerId: null,
        content: sample.content(),
      });

      if (result.delivered) sent += 1;
      else failed += 1;

      console.log(
        `${result.delivered ? '  sent' : 'FAILED'}  ${to.padEnd(24)} ${sample.label}`,
      );

      // Resend rate-limits bursts, and a sample run is not urgent.
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  console.log(`\n${String(sent)} sent, ${String(failed)} failed — see /admin/emails for all of them.`);

  await disconnectDatabase();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
