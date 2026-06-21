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
# Needed at BUILD time too: the root layout reads platform_settings via the
# service client in generateMetadata/generateViewport, which runs while
# prerendering static pages (e.g. /_not-found). Vercel made all env available
# at build; we mirror that. Declared ONLY in this builder stage, so it is NOT
# present in the final `runner` image (kept clean of the service-role key).
ARG SUPABASE_SERVICE_ROLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
