import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginButton } from './login-button'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) redirect('/home')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">Travel Maker</h1>
      <p className="text-muted-foreground">Google 계정으로 로그인하세요.</p>
      <LoginButton />
    </main>
  )
}
