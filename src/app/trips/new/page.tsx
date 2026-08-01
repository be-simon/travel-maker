import { NewTripWizard } from './new-trip-wizard'

export default function NewTripPage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-6 text-xl font-semibold">새 여행 만들기</h1>
      <NewTripWizard />
    </main>
  )
}
