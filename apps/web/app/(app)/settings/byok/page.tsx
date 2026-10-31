import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ByokForm } from './byok-form';

export default async function ByokSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('byok_enabled, encrypted_byok_keys')
    .eq('id', user!.id)
    .single();

  if (!profile?.byok_enabled) redirect('/dashboard');

  return (
    <>
      <h1>BYOK 設定</h1>
      <p className="muted">僅 owner 帳戶可見。金鑰以 AES-GCM 加密儲存，不會以明文回傳。</p>
      <ByokForm />
    </>
  );
}
