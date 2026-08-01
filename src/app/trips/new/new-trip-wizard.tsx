'use client'

import { useState, useTransition } from 'react'
import { createTrip } from '@/lib/trips/actions'
import { validateTripDates } from '@/lib/trips/validation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Step = 1 | 2

export function NewTripWizard() {
  const [step, setStep] = useState<Step>(1)
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const goToStep2 = () => {
    if (!title.trim()) return setError('여행 이름을 입력해 주세요.')
    const dateError = validateTripDates(startDate, endDate)
    if (dateError) return setError(dateError)
    setError(null)
    setStep(2)
  }

  const submit = () => {
    startTransition(async () => {
      const result = await createTrip({ title, startDate, endDate })
      if (result.error) setError(result.error)
    })
  }

  if (step === 1) {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">여행 이름</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 이탈리아 여행" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">시작일</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">종료일</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={goToStep2}>다음</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 font-medium">저장한 장소 가져오기</h2>
        <p className="text-sm text-muted-foreground">
          국가·도시 기반 저장한 장소 가져오기는 다음 업데이트에서 제공됩니다. 지금은 빈 여행으로
          시작합니다.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(1)}>
          이전
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? '만드는 중…' : '여행 만들기'}
        </Button>
      </div>
    </div>
  )
}
