import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // .claude/worktrees/* nests a full second checkout (including its own
    // src/test/*.test.ts) inside this tree during Claude Code sessions that
    // use git worktrees — without this exclude, Vitest's default glob picks
    // those up too and double-runs every test against the same local
    // Supabase instance, causing spurious failures unrelated to real code.
    // Includes Vitest's own defaults (https://vitest.dev/config/#exclude)
    // since setting `exclude` replaces them rather than appending.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.claude/**',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
