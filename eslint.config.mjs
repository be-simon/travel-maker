import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase Edge Functions는 Deno 런타임 — Node 툴체인(tsc/eslint) 대상이 아니다.
    // (vitest는 Deno API 없는 logic.test.ts만 계속 실행한다.)
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
