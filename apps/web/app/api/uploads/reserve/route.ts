import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { jobInputPath } from '@video-transcriber/shared';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const name = typeof body?.fileName === 'string' ? body.fileName : '';
  const inputPath = jobInputPath(user.id, body?.jobId, name);
  if (!inputPath || !name || name.length > 255 || !/\.(mp4|mov|webm)$/i.test(name)) {
    return NextResponse.json({ error: 'Choose an MP4, MOV or WebM video' }, { status: 400 });
  }
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: 'Uploads unavailable' }, { status: 503 });
  const objectPath = inputPath.slice('user-uploads/'.length);
  const { error } = await service.rpc('reserve_upload', {
    p_user_id: user.id, p_job_id: body.jobId, p_object_path: objectPath,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '54000' ? 429
      : error.code === '23505' ? 409 : ['22023','P0002'].includes(error.code) ? 400 : 503;
    return NextResponse.json({ error: status === 503 ? 'Uploads unavailable' : error.message }, { status });
  }
  // The browser uses its authenticated session. Storage checks this reservation
  // AND current entitlement; no bearer upload token can outlive trial access.
  return NextResponse.json({ objectPath });
}
