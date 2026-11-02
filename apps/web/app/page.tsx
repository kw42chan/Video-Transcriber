import { redirect } from 'next/navigation';

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const code = params.code;
  if (typeof code === 'string' && code.length > 0) {
    const callback = new URLSearchParams();
    callback.set('code', code);
    for (const [key, value] of Object.entries(params)) {
      if (key === 'code' || value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((entry) => callback.append(key, entry));
      } else {
        callback.set(key, value);
      }
    }
    redirect(`/auth/callback?${callback.toString()}`);
  }
  redirect('/login');
}
