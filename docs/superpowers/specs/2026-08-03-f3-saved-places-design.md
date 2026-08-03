# F3 코어 — 저장한 장소 라이브러리 + 여행에 담기 설계

- 날짜: 2026-08-03
- 근거: docs/PRD.md §4 F3, §3.1(2단 네비), §7(bookmarks/spots)
- 범위 결정: 코어 먼저 — Google 지도 링크 해석(Edge Function)과 캡처 OCR은 다음 사이클로 분리.
  여행 장소(스팟) 필드 편집(우선순위·비용·상태)도 별도 사이클로 분리.
  담기 진입점은 플랜 화면 장소 패널만(여행 생성 위저드 일괄 담기는 다음 사이클).

## 목표

계정 단위 "저장한 장소" 라이브러리를 처음으로 사용 가능하게 만든다:

1. `/places` 화면에서 직접 입력(Places 검색)으로 장소를 저장·수정·삭제한다.
2. 저장 시 국가/도시가 자동 태깅되고, place_id 중복이 감지된다.
3. 텍스트 검색과 국가/도시/카테고리 필터 칩으로 목록을 좁힌다.
4. 플랜 화면 장소 패널에서 내 라이브러리를 열어 선택한 북마크를 여행 장소(스팟)로 복사한다.

## 1. 데이터 (마이그레이션 1건)

`bookmarks` 테이블·RLS(`bookmarks_all`, 소유자 전용)는 initial_schema에 이미 존재한다.
변경은 하나: 기존 non-unique 인덱스 `bookmarks_owner_place_idx`를 unique partial index로 교체한다.

```sql
drop index if exists public.bookmarks_owner_place_idx;
create unique index bookmarks_owner_place_uniq
  on public.bookmarks (owner_id, place_id) where place_id is not null;
```

- place_id 기반 중복 저장을 DB 레벨에서 차단한다 (PRD: "중복이면 저장 대신 기존 항목으로 안내").
- place_id가 null인 수동 입력은 중복 제약을 받지 않는다.

## 2. 라이브러리 모듈 `src/lib/bookmarks/`

기존 `trips`/`spots` 모듈과 같은 3파일 구조.

- `validation.ts` — `validateBookmarkName` (spots와 동일 규칙: 공백 제거 후 1자 이상).
- `queries.ts` — `listMyBookmarks()`: 본인 북마크 전체(생성일 역순). RLS가 소유자 격리를 보장하므로
  명시적 owner 필터는 두지 않는다(기존 쿼리 패턴과 동일).
- `actions.ts` (server actions, `ActionResult` 패턴):
  - `createBookmark(input)` — name/category/country/city/placeId/lat/lng/address/memo,
    `source: 'manual'`, `owner_id`는 세션 유저. unique 위반(23505)이면
    "이미 저장한 장소예요" 반환.
  - `updateBookmark(id, fields)` — 이름·카테고리·국가·도시·메모 수정.
  - `deleteBookmark(id)`.
  - `importBookmarks(tripId, bookmarkIds)` — §5 참고.
  - 각 액션은 `revalidatePath('/places')` (import는 plan 경로).

## 3. 공용 컴포넌트 `PlaceSearchInput`

`src/components/places/place-search-input.tsx` (client).

- 기존 AddSpotDialog의 이름 입력 + `useAutocompleteSuggestions` 제안 목록 + 선택 로직을 추출.
- 선택 시 `fetchFields(['displayName', 'formattedAddress', 'location', 'addressComponents'])`
  후 `onSelect(selection)` 콜백:

```ts
interface PlaceSelection {
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  placeId: string
  country: string | null // addressComponents type 'country'의 longText
  city: string | null    // 'locality' 우선, 없으면 'administrative_area_level_1' fallback
}
```

- 국가/도시 추출은 순수 함수 `extractCountryCity(components)`로 분리해 단위 테스트한다.
  PRD는 "좌표 기반 역지오코딩"을 명시했으나 addressComponents로 같은 결과를 추가 API 호출
  없이 얻으므로 이 방식을 채택한다(수단만 다름).
- 입력을 수정하면 이전 선택(placeId 등)을 무효화하는 기존 동작, fetchFields 실패 시 폼을
  건드리지 않고 에러 메시지만 보여주는 기존 방어 패턴을 그대로 유지한다.
- `AddSpotDialog`는 이 컴포넌트를 사용하도록 교체한다. 동작 변화 없음(요청 필드에
  addressComponents가 추가될 뿐이며, 스팟 생성은 country/city를 사용하지 않고 무시한다).

## 4. 저장한 장소 화면 `/places`

- `src/app/places/page.tsx` (server): 미인증이면 `/login` 리다이렉트(기존 미들웨어/페이지 패턴
  확인 후 동일하게), `listMyBookmarks()` 조회, `MapProvider`로 감싼 클라이언트에 전달.
- `places-library.tsx` (client):
  - 검색 입력: 이름·주소·메모 부분 일치(대소문자 무시). 순수 함수
    `filterBookmarks(bookmarks, {query, country, city, category})`로 분리해 테스트.
  - 필터 칩: 보유 데이터에서 도출한 국가/도시/카테고리 목록. 단일 선택 토글(같은 칩 재클릭 시 해제).
  - 목록 행: 이름, 카테고리, 국가/도시, 메모 요약 + 수정/삭제 버튼. 삭제는 confirm 후 실행.
- `bookmark-dialog.tsx` (client): 추가·수정 겸용.
  - 추가 모드: PlaceSearchInput + 카테고리 + 국가/도시(자동 채움, 수동 수정 가능) + 메모.
    Places 선택 즉시 부모가 가진 기존 북마크 목록에서 place_id 일치를 확인, 중복이면 해당
    기존 항목 이름과 함께 "이미 저장된 장소예요" 안내를 보여주고 저장 버튼을 비활성화한다.
  - 수정 모드: Places 재검색 없이 이름/카테고리/국가/도시/메모만 편집(place_id·좌표 유지).
- 네비게이션(계정 레벨 2단 네비 최소 구현): 홈 헤더에 "저장한 장소" 링크, `/places` 헤더에
  "내 여행" 링크.

## 5. 플랜 패널 "저장한 장소에서 담기"

- `SpotPanel`에 "저장한 장소에서 담기" 버튼 추가 → `ImportBookmarksDialog` (client).
  - 열릴 때 내 북마크 목록을 서버에서 조회(플랜 page는 트립 데이터만 갖고 있으므로 page에서
    `listMyBookmarks()`를 함께 조회해 내려준다).
  - 검색 입력(위 filterBookmarks 재사용) + 체크박스 다중 선택.
  - 이미 이 여행에 담긴 북마크는 "담김" 배지 + 비활성. 판정: 해당 트립 spots 중
    `bookmark_id` 일치 또는 (양쪽 place_id가 있을 때) place_id 일치. 순수 함수
    `isBookmarkImported(bookmark, spots)`로 분리해 테스트.
- `importBookmarks(tripId, bookmarkIds)` server action:
  - 각 북마크의 소유 확인은 RLS(select)로 자연 보장 — 조회로 가져온 뒤 spots로 insert.
  - 복사 필드: name, category, place_id, lat, lng, address, memo. 추가로
    `bookmark_id`(provenance), `status: 'candidate'`, `group_id: null`(미분류).
  - 이후 스팟 편집은 원본 북마크에 영향 없음(복사본 원칙, 스키마가 이미 보장).
  - 그룹(도시) 자동 배정은 범위 제외.

## 6. 에러 처리

- 서버 액션: 기존 패턴 — `console.error` + 사용자에겐 일반 안내 메시지. create의 23505만
  전용 메시지("이미 저장한 장소예요").
- Places fetchFields 실패: 폼 상태를 건드리지 않고 재시도 안내(기존 AddSpotDialog 패턴).
- import 부분 실패: insert는 단건씩이 아니라 배열 insert 1회로 처리 — 실패 시 전체 실패로
  간주하고 일반 에러 메시지(부분 성공 상태를 만들지 않는다).

## 7. 테스트

기존 vitest 패턴(`*.test.ts`, 순수 함수 단위 테스트)을 따른다.

- `validation.test.ts` — 이름 검증.
- `extractCountryCity` — locality 존재/부재(fallback)/빈 배열.
- `filterBookmarks` — 쿼리 부분 일치(이름·주소·메모), 칩 필터 조합, 대소문자.
- `isBookmarkImported` — bookmark_id 일치, place_id 일치, 불일치.
- RLS: 기존 `rls-trips.test.ts` 헬퍼로 bookmarks 소유자 격리(타인 북마크 조회/삽입 차단)와
  place_id unique 제약 동작 검증.

## 범위 제외 (다음 사이클)

- Google 지도 링크 입력(Edge Function 리다이렉트 해석), 캡처 OCR(Cloud Vision).
- 여행 생성 위저드의 국가/도시 매칭 일괄 담기(F2), 저장한 장소 화면에서 여행 선택해 담기.
- 여행 장소(스팟) 필드 편집 UI(우선순위·비용·링크·상태)와 스팟 수정/삭제 액션.
- 담기 시 도시 그룹 자동 배정.
