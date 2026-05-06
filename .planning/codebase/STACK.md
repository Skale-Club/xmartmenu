# Technology Stack

**Analysis Date:** 2026-05-05

## Languages

**Primary:**
- TypeScript 5 - Used throughout entire project (src/, scripts/)
- JavaScript (JSX/TSX) - React components in src/app/ and src/components/

**Secondary:**
- SQL - Supabase migrations in `supabase/migrations/`

## Runtime

**Environment:**
- Node.js v24.13.0 (or compatible versions)

**Package Manager:**
- npm (using package-lock.json)
- pnpm-workspace.yaml present for workspace configuration
- Lockfile: `package-lock.json` (273KB, version 3)

## Frameworks

**Core:**
- Next.js 16.2.2 - Full-stack React framework with App Router
- React 19.2.4 - UI library
- React DOM 19.2.4 - React rendering for web

**Styling:**
- Tailwind CSS 4 - Utility-first CSS framework
- @tailwindcss/postcss 4 - PostCSS plugin for Tailwind
- tailwind-merge 3.5.0 - Merge Tailwind classes conditionally

**Development/Build:**
- TypeScript 5 - Static type checking
- tsx 4.19.0 - TypeScript execution for Node.js (seed scripts)
- dotenv 16.0.0 - Environment variable loading

**Code Quality:**
- ESLint 9 - Linting
- eslint-config-next 16.2.2 - Next.js-specific ESLint rules
- PostCSS (via postcss.config.mjs) - CSS transformation

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.101.1 - Supabase JavaScript client (queries, auth)
- @supabase/ssr 0.10.0 - Server-side rendering support for Supabase (cookie management)
- pg 8.20.0 - PostgreSQL client (for direct database connections in seed scripts)

**Utilities:**
- qrcode 1.5.4 - QR code generation (`src/app/(admin)/settings/qrcode/`)
- @types/qrcode 1.5.6 - TypeScript types for qrcode
- sharp 0.34.5 - Image processing (WebP conversion in `src/lib/upload.ts`)
- lucide-react 1.7.0 - Icon library (React components)
- clsx 2.1.1 - Conditional className utility

**Development:**
- @types/node 20 - Node.js type definitions
- @types/react 19 - React type definitions
- @types/react-dom 19 - React DOM type definitions

## Configuration

**Environment:**
- Required vars (from `.env.example`):
  - `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
  - `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-only)
- Optional vars:
  - `NEXT_PUBLIC_APP_URL` - Application URL (defaults to localhost:3000 in dev)

**Build:**
- `tsconfig.json` - TypeScript compiler options
  - Target: ES2017
  - Module: ESNext
  - Path alias: `@/*` → `./src/*`
  - Strict mode enabled
- `next.config.ts` - Next.js configuration
  - Image remote patterns: Supabase storage (*.supabase.co)
  - ESM module format
- `postcss.config.mjs` - PostCSS configuration
  - @tailwindcss/postcss plugin enabled
- `eslint.config.mjs` - ESLint configuration
  - Next.js core-web-vitals rules
  - Next.js TypeScript rules
  - Ignores: .next/, build/, out/

**Workspace:**
- `pnpm-workspace.yaml` - pnpm workspace configuration
  - `sharp` and `unrs-resolver` in ignoredBuiltDependencies (native modules)

## Platform Requirements

**Development:**
- Node.js 20+ (or v24 as tested)
- npm or pnpm
- Supabase project (local or remote)

**Production:**
- Deployment target: Vercel (Next.js optimized) or any Node.js-compatible platform
- Environment variables must include Supabase credentials
- Requires Supabase PostgreSQL backend

## Build & Run Commands

```bash
npm run dev        # Start development server (localhost:3000)
npm run build      # Build for production
npm run start      # Start production server
npm run lint       # Run ESLint
npm run seed       # Execute TypeScript seed script
```

---

*Stack analysis: 2026-05-05*
