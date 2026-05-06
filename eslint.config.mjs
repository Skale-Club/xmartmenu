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
  ]),
  {
    rules: {
      // Supabase generics and complex DB types make `any` pragmatic — warn, don't block
      '@typescript-eslint/no-explicit-any': 'warn',
      // External links (tel:, mailto:, wa.me) and API-route anchors are intentional — warn, don't block
      '@next/next/no-html-link-for-pages': 'warn',
      // Date.now() in async server components is safe — false positive from React hooks linter
      'react-hooks/purity': 'warn',
      // setState-in-effect pattern — real anti-pattern but non-blocking; fix incrementally
      'react-hooks/set-state-in-effect': 'warn',
      // Unescaped entities — cosmetic, fix incrementally
      'react/no-unescaped-entities': 'warn',
    },
  },
]);

export default eslintConfig;
