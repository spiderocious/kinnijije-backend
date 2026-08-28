/**
 * The email design system, as functions.
 *
 * Specs: design-system/projects/kinnijije-v2/preview/480-484.
 *
 * Email clients have no CSS variables, no flexbox and unreliable border-radius,
 * so every one of these is TABLES and INLINE STYLES with the token values
 * written out literally. The blade (24px 6px 24px 6px) survives where radius is
 * supported and degrades to a rectangle in Outlook, which the spec accepts —
 * the colour, the type and the copy carry the identity.
 *
 * Nothing here animates and nothing depends on an image loading.
 */

/** The palette, written out because an email cannot read a variable. */
export const INK = '#132430';
export const INK_2 = '#3A5567';
export const INK_3 = '#6E8798';
export const PAPER = '#F7FAFC';
export const WHITE = '#FFFFFF';
export const SKY = '#38B6F0';
export const SKY_DEEP = '#1798D6';
export const SKY_DARK = '#0B4E71';
export const CAUTION = '#E0834E';
export const SUCCESS = '#2C6B45';
export const CRITICAL = '#8E3560';

/** Exported so templates building their own markup match the components. */
export const FONT_STACK = 'Nunito,Helvetica,Arial,sans-serif';
const FONT = FONT_STACK;

/** Escapes anything interpolated into an email — names, meal titles, reasons. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The masthead. Same on every email, so nobody has to wonder who sent it. */
export function header(): string {
  return `<tr><td style="background:${PAPER};border-bottom:2px solid ${INK};padding:16px 22px">
    <span style="font-family:${FONT};font-weight:800;font-size:21px;color:${INK}">Kinni<span style="color:${SKY_DEEP}">Jije</span></span>
  </td></tr>`;
}

/**
 * The one action. A bulletproof-ish button: a table, not an anchor with
 * padding, because Outlook drops padding on inline elements.
 */
export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
    <tr><td style="background:${SKY};border:2px solid ${INK};border-radius:20px 5px 20px 5px;box-shadow:3px 4px 0 ${INK}">
      <a href="${href}" style="display:block;padding:12px 26px;font-family:${FONT};font-weight:800;font-size:15px;color:${WHITE};text-decoration:none">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** A meal, or anything else worth its own box. */
export function card(options: {
  readonly title: string;
  readonly body: string;
  readonly meta?: string;
  readonly accent?: string;
}): string {
  const accent = options.accent ?? CAUTION;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${INK};border-radius:18px 5px 18px 5px;overflow:hidden;margin:0 0 12px">
    <tr><td style="background:${accent};height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:13px 15px;font-family:${FONT}">
      <p style="margin:0;font-weight:800;font-size:16px;color:${INK}">${esc(options.title)}</p>
      <p style="margin:5px 0 0;font-size:14px;line-height:1.55;color:${INK_2}">${options.body}</p>
      ${
        options.meta === undefined
          ? ''
          : `<p style="margin:7px 0 0;font-size:12px;color:${INK_3}">${esc(options.meta)}</p>`
      }
    </td></tr>
  </table>`;
}

/** A plain paragraph, at the right measure. */
export function p(text: string, options: { readonly muted?: boolean } = {}): string {
  const colour = options.muted === true ? INK_3 : INK_2;
  return `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.6;color:${colour}">${text}</p>`;
}

/** A heading inside the body. */
export function h(text: string): string {
  return `<p style="margin:0 0 10px;font-family:${FONT};font-weight:800;font-size:19px;line-height:1.3;color:${INK}">${esc(text)}</p>`;
}

/** A simple list, since <ul> margins are unreliable across clients. */
export function list(items: readonly string[]): string {
  return items
    .map(
      (item) =>
        `<p style="margin:0 0 6px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK_2}">• ${item}</p>`,
    )
    .join('');
}

/**
 * The footer, and the unsubscribe line.
 *
 * `manageHref` is REQUIRED for anything opt-in: an email somebody cannot turn
 * off from the email itself is the one that gets marked as spam.
 */
export function footer(manageHref?: string): string {
  const manage =
    manageHref === undefined
      ? ''
      : ` · <a href="${manageHref}" style="color:${SKY_DARK}">Choose what we send you</a>`;

  return `<tr><td style="background:${PAPER};border-top:2px solid ${INK};padding:16px 22px">
    <p style="margin:0;font-family:${FONT};font-size:11.5px;color:${INK_3};line-height:1.6">
      KinniJije — cook what you already have.${manage}
    </p>
  </td></tr>`;
}

/** Wraps a body in the frame. 520px, bordered, blade-cornered. */
export function shell(body: string, manageHref?: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:${PAPER}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="margin:0 auto;background:${WHITE};border:2px solid ${INK};border-radius:24px 6px 24px 6px;overflow:hidden;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK}">
    ${header()}
    <tr><td style="padding:24px 22px">${body}</td></tr>
    ${footer(manageHref)}
  </table>
</body></html>`;
}
