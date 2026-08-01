'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function LoginButton() {
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    const supabase = createClient()
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (oauthError) {
      setError('로그인에 실패했습니다. 다시 시도해 주세요.')
    } else {
      setError(null)
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleLogin}>Google로 로그인</Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
