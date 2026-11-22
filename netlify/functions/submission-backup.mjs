import { submissionBackups } from '../lib/submission-backups.mjs';
import { submissionBackupKey } from '../lib/submission-archive.mjs';
import { deployContext } from '../lib/store.mjs';

export const config = { schedule: '20 8 * * *' };

export default async function scheduledSubmissionBackup(request) {
  const key = submissionBackupKey();
  if (key && process.env.NETLIFY_DEV !== 'true' && deployContext() === 'production') {
    await submissionBackups({ key }).capture(request, { scheduled: true });
  }
  return new Response(null, { status: 204 });
}
