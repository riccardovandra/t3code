# Docs Cloud

Private hosted doc editor at `docs.upliftedconsulting.com`. One Cloudflare Worker serves the SPA (static assets from `dist/`), the JSON API under `/api`, and the agent MCP endpoint under `/mcp`. Each doc has a `DocRoom` Durable Object that applies every write in order and pushes it to open editors over WebSocket. Data lives in D1 (`migrations/`).

T3 Code embeds the app in its Docs panel. `FRAME_ANCESTORS` in `wrangler.jsonc` lists the origins allowed to frame it (CSP `frame-ancestors`); every other origin gets a non-frameable page. `src/client/embedBridge.ts` and `src/shared/embed.ts` hold the postMessage protocol T3 Code uses to navigate the app and follow its location.

Sign-in is a 6-digit code by email (Resend). Every address in `OWNER_EMAILS` signs in as the one admin user, who owns everything created before sharing existed and is the only one who creates projects. Anyone else can sign in once a doc has been shared with their address. Docs are private to their members, each an owner, editor, commenter or viewer (`src/shared/access.ts`); the checks live in `src/worker/access.ts`. Agents and T3 Code use bearer tokens created under Settings, and act as the person who created the token.

## Local development

Wrangler is not a workspace dependency; use a global install (`npm i -g wrangler`).

```sh
cd apps/docs-cloud
vp build                                   # SPA into dist/
wrangler d1 migrations apply DB --local    # local D1 under .wrangler/
wrangler dev --port 8787
```

Put `PUBLIC_ORIGIN=http://localhost:8787` (your port) in `.dev.vars`. `wrangler dev` reports the production domain as the request URL, so without it the links agents get point at production.

Without `RESEND_API_KEY`, sign-in codes are printed to the `wrangler dev` console. Rebuild with `vp build` (or `vp build --watch` in a second terminal) after client changes.

Tests: `vp test run apps/docs-cloud` from the repo root. Typecheck: `vp run --filter @t3tools/docs-cloud typecheck`.

## Deploy

The D1 database and the `RESEND_API_KEY` secret already exist in the Cloudflare account that owns `upliftedconsulting.com`.

1. Authenticate wrangler: `wrangler login`, or export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. `vp run --filter @t3tools/docs-cloud deploy` builds, applies remote migrations and deploys. The `docs.upliftedconsulting.com` custom domain is attached on deploy.

To rotate the email key: `wrangler secret put RESEND_API_KEY`. The `EMAIL_FROM` domain must stay verified in Resend.
