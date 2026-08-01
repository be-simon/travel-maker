# Travel Maker

여행별 워크스페이스를 만들어 장소 수집 → 시간대별 일정 배치 → 여행 중 실시간 조정까지 하나의 도구로 해결하는 협업형 여행 계획 웹서비스.

- 제품 스펙: [`docs/PRD.md`](docs/PRD.md)
- 클릭 가능한 프로토타입: [`docs/prototype.html`](docs/prototype.html)
- UX 리뷰/재설계 근거: [`docs/UX_REVIEW.md`](docs/UX_REVIEW.md), [`docs/UX_REDESIGN.md`](docs/UX_REDESIGN.md)

## 스택

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + dnd-kit / Supabase (Postgres, Auth, Realtime, RLS) / Google Maps JS API + Places API (New).

## 시작하기

```bash
cp .env.example .env.local   # Supabase/Google Maps 키 채우기
pnpm install
pnpm dev
```

[http://localhost:3000](http://localhost:3000)

로컬 Supabase 스택(DB/Auth 에뮬레이션):

```bash
supabase start
```

## 마일스톤

- **M1** — 워크스페이스/인증/저장한 장소 (F1, F2, F3)
- **M2** — 플랜 화면: 타임라인 + 지도 (F4, F5)
- **M3** — Today 모드 + 준실시간 동기화 (F6, F7)

자세한 범위는 [`docs/PRD.md`](docs/PRD.md) 9장 참고.
