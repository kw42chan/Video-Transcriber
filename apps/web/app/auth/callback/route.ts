import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function appOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type');
  const nextPath = requestUrl.searchParams.get('next') ?? '/dashboard';
  const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/dashboard';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, appOrigin()));
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email',
    });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, appOrigin()));
    }
  }

  const loginUrl = new URL('/login', appOrigin());
  loginUrl.searchParams.set('error', 'auth_callback');
  return NextResponse.redirect(loginUrl);
}
