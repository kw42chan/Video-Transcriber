import { NextResponse } from 'next/server';
import {
  decryptByokKeys,
  encryptByokKeys,
  maskByokKeys,
  type ByokKeySet,
  type EncryptedByokPayload,
} from '@video-transcriber/shared';
import { createClient } from '@/lib/supabase/server';

async function loadProfile(userId: string) {
  const supabase = await createClient();
  return supabase
    .from('profiles')
    .select('byok_enabled, encrypted_byok_keys')
    .eq('id', userId)
    .single();
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await loadProfile(user.id);
  if (!profile?.byok_enabled) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!profile.encrypted_byok_keys) {
    return NextResponse.json({ mask: maskByokKeys({}) });
  }

  const encKey = process.env.BYOK_ENCRYPTION_KEY;
  if (!encKey) return NextResponse.json({ error: 'BYOK_ENCRYPTION_KEY not set' }, { status: 503 });

  const keys = await decryptByokKeys(profile.encrypted_byok_keys as EncryptedByokPayload, encKey);
  return NextResponse.json({ mask: maskByokKeys(keys) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await loadProfile(user.id);
  if (!profile?.byok_enabled) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const encKey = process.env.BYOK_ENCRYPTION_KEY;
  if (!encKey) return NextResponse.json({ error: 'BYOK_ENCRYPTION_KEY not set' }, { status: 503 });

  const incoming = (await req.json()) as ByokKeySet;
  let merged: ByokKeySet = {};

  if (profile.encrypted_byok_keys) {
    merged = await decryptByokKeys(profile.encrypted_byok_keys as EncryptedByokPayload, encKey);
  }

  if (incoming.openrouter) merged.openrouter = incoming.openrouter;
  if (incoming.cantoGen) merged.cantoGen = incoming.cantoGen;
  if (incoming.synclabs) merged.synclabs = incoming.synclabs;
  if (incoming.fal) merged.fal = incoming.fal;

  const encrypted = await encryptByokKeys(merged, encKey);
  // Column-level grant: authenticated may update encrypted_byok_keys only (not byok_enabled).
  const { error } = await supabase
    .from('profiles')
    .update({ encrypted_byok_keys: encrypted })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mask: maskByokKeys(merged) });
}
