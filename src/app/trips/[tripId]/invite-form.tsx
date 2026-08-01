'use client'

import { useState, useTransition } from 'react'
import { inviteMember } from '@/lib/trips/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function InviteForm({ tripId }: { tripId: number }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const result = await inviteMember(tripId, email)
      if (result.error) {
        setError(result.error)
      } else {
        setError(null)
        setEmail('')
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="초대할 Google 계정 이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button onClick={submit} disabled={isPending}>
          초대
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
