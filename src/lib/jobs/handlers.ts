import { registerExtractionHandlers } from '@features/extraction/extraction.jobs.js';
import { registerInsightHandlers } from '@features/insights/insights.jobs.js';
import { registerNotificationHandlers } from '@features/notifications/notifications.jobs.js';

/**
 * The one place job handlers are registered.
 *
 * Called at boot, BEFORE the worker starts — a worker that starts first can
 * claim a job whose handler does not exist yet, and that job then fails for a
 * reason nobody could act on.
 *
 * Handlers live with their feature; this file only wires them up, so the queue
 * never imports a feature and features never import the worker loop.
 */
export function registerJobHandlers(): void {
  registerExtractionHandlers();
  registerInsightHandlers();
  registerNotificationHandlers();
}
