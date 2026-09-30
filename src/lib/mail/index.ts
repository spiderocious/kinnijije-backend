export { emailService } from './email.service.js';
export { EMAIL_KINDS, EmailLogModel, type EmailKind } from './email-log.model.js';
export { EmailSettingModel } from './email-settings.model.js';
export {
  MAIL_PROVIDERS,
  MAIL_PROVIDER_SETTING_ID,
  MailProviderSettingModel,
  type MailProvider,
} from './mail-provider.model.js';
export { assertMailerConfigured, mailer } from './mailer.js';
export * from './templates.js';
