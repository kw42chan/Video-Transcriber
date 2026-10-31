import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { jobInputPath } from '@video-transcriber/shared';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const jobId = body.jobId as string | undefined;
  const inputPath = body.inputPath as string | undefined;
  const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const expectedInputPath = jobInputPath(user.id, jobId, fileName);

  if (!expectedInputPath || inputPath !== expectedInputPath || !projectName || projectName.length > 80 || !fileName || fileName.length > 255) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const service = createServiceClient();
  if (!service) {
    return NextResponse.json({ error: 'Job creation unavailable' }, { status: 503 });
  }

  // The RPC checks entitlement and consumes a trial atomically. Client-provided
  // durationSeconds is unverified and must not decide access (see MVP_SETUP).
  const { data: id, error } = await service.rpc('create_job_with_trial', {
    p_user_id: user.id,
    p_job_id: jobId,
    p_input_path: expectedInputPath,
    p_project_name: projectName,
    p_file_name: fileName,
  });

  if (error) {
    const status = error.code === '42501' ? 403
      : error.code === 'P0002' || error.code === '22023' ? 400
      : error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: status === 500 ? 'Could not create job' : error.message }, { status });
  }

  return NextResponse.json({ id });
}
