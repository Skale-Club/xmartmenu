# syntax=docker/dockerfile:1
#
# Multi-stage build for the shared Coolify/Hetzner host.
#
# Base tag `node:24-alpine` is DELIBERATE and MUST be identical across every app
# on this host — Docker stores the base layer once and reuses it, which is what
# keeps the 80GB shared box from filling up. Do not bump it for one app alone.
# (See skaleclub-apps/COOLIFY.md → "Disk discipline".)
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat   # glibc shim sharp's prebuilt binary expects on musl
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- deps: install node_modules from the lockfile ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the Next.js app ----
FROM base AS builder
# NEXT_PUBLIC_* are inlined at BUILD time -> must arrive as build ARGs, not just
# runtime env. Runtime-only secrets (service-role key, Stripe secret, etc.) are
# intentionally NOT here — they're injected at runtime by Coolify.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
# The commit being built: Sentry release and /api/health/ready "release".
ARG GIT_SHA=dev
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_RELEASE=$GIT_SHA \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Secrets arrive as BuildKit secret mounts, present only while this RUN runs:
# never in ARG/ENV, image history, layer metadata or the build cache.
#   supabase_service_role_key  the root layout reads platform_settings through
#                              the service client while prerendering
#   sentry_auth_token          optional; uploads source maps when present
RUN --mount=type=secret,id=supabase_service_role_key,env=SUPABASE_SERVICE_ROLE_KEY \
    --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    npm run build

# ---- runner: minimal runtime image ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# ffmpeg re-encodes uploaded dish videos to light MP4s (src/lib/media/video.ts).
RUN apk add --no-cache ffmpeg
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
