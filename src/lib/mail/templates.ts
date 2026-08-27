/**
 * Email copy lives here, beside the message registry in spirit: not inline at
 * a callsite where it cannot be reviewed as copy.
 */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const shell = (heading: string, body: string): string => `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#F7FAFC;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1A202C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:0 16px 16px 16px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${heading}</h1>
        ${body}
        <p style="margin:32px 0 0;font-size:13px;color:#718096;">— The Cookiepot kitchen</p>
      </td></tr>
    </table>
  </body>
</html>`;

export const welcomeEmail = (name: string): EmailContent => ({
  subject: 'Welcome to Cookiepot',
  html: shell(
    `Welcome, ${name}`,
    `<p style="margin:0;font-size:15px;line-height:1.6;">Your kitchen is ready. Start by telling us what is in it — we will take it from there.</p>`,
  ),
  text: `Welcome, ${name}. Your kitchen is ready. Start by telling us what is in it — we will take it from there.`,
});

export const passwordChangedEmail = (name: string): EmailContent => ({
  subject: 'Your Cookiepot password was changed',
  html: shell(
    'Password changed',
    `<p style="margin:0;font-size:15px;line-height:1.6;">Hi ${name}, the password on your account was just changed, and every other signed-in device was signed out.</p>
     <p style="margin:16px 0 0;font-size:15px;line-height:1.6;">If this was not you, reset your password immediately.</p>`,
  ),
  text: `Hi ${name}, the password on your account was just changed and every other device was signed out. If this was not you, reset your password immediately.`,
});

export const statusChangedEmail = (name: string, status: string, reason?: string): EmailContent => ({
  subject: `Your Cookiepot account is now ${status}`,
  html: shell(
    'Account status updated',
    `<p style="margin:0;font-size:15px;line-height:1.6;">Hi ${name}, your account status is now <strong>${status}</strong>.</p>
     ${reason !== undefined ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.6;">Reason: ${reason}</p>` : ''}`,
  ),
  text: `Hi ${name}, your account status is now ${status}.${reason !== undefined ? ` Reason: ${reason}` : ''}`,
});
