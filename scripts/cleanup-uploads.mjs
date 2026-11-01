// Retention maintenance: dry run by default. Never deletes completed outputs.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { userUploadObjectPath } from '@video-transcriber/shared';

const days = Number(process.env.UPLOAD_RETENTION_DAYS ?? '7');
if (!Number.isInteger(days) || days < 1) throw new Error('UPLOAD_RETENTION_DAYS must be at least 1');
const apply = process.argv.includes('--apply');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server credentials required');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const cutoff = new Date(Date.now()-days*86400000).toISOString();
const { data: reservations, error } = await db.from('upload_reservations')
  .select('job_id,user_id,object_path').lt('expires_at', cutoff).order('created_at').limit(100);
if (error) throw new Error('Could not load expired uploads');
let eligible = 0;
for (const reservation of reservations ?? []) {
  const objectPath = userUploadObjectPath(`user-uploads/${reservation.object_path}`, reservation.user_id);
  const { data: jobs, error: jobError } = await db.from('jobs').select('id')
    .eq('input_path', `user-uploads/${objectPath}`).in('status', ['pending','running']).limit(1);
  if (jobError) throw new Error('Could not check active jobs');
  if (jobs?.length) continue;
  eligible++;
  if (apply) {
    const { error: deleteError } = await db.storage.from('user-uploads').remove([objectPath]);
    if (deleteError) throw new Error('Could not remove expired upload');
    const { error: rowError } = await db.from('upload_reservations').delete().eq('job_id', reservation.job_id);
    if (rowError) throw new Error('Could not remove expired reservation');
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', eligible, retentionDays: days }));
