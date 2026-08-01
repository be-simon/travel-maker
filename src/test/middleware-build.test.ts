import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Regression guard for a real bug that shipped and survived 5 approved task
// reviews: middleware.ts lived at the repo root instead of src/ in a
// --src-dir project, so Next.js silently never wired it up — no build
// error, no lint error, no runtime error, just a middleware that never ran
// (auth gating quietly disabled). Nothing else in the suite ever exercises
// an actual `next build`, so nothing caught it.
//
// This runs a real production build and asserts the middleware manifest
// actually contains an entry. It's the one check in this repo that would
// have caught that exact failure mode — a build that "succeeds" while
// quietly dropping the middleware. Running a full build inside a test is
// slower than a unit test (~10-20s here), but still far cheaper than an e2e
// browser test, and this is the cheapest check that can tell the
// difference between "middleware compiled" and "middleware registered".
describe('middleware build guard', () => {
  const projectRoot = path.resolve(import.meta.dirname, '../..')

  it(
    'a production build registers middleware in the middleware manifest',
    () => {
      execSync('pnpm build', { cwd: projectRoot, stdio: 'pipe' })

      const manifestPath = path.join(projectRoot, '.next/server/middleware-manifest.json')
      expect(existsSync(manifestPath)).toBe(true)

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        sortedMiddleware?: string[]
      }

      expect(Array.isArray(manifest.sortedMiddleware)).toBe(true)
      expect(manifest.sortedMiddleware!.length).toBeGreaterThan(0)
    },
    120_000,
  )
})
