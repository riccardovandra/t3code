# Docs Cloud

Private hosted doc editor at `docs.upliftedconsulting.com`. One Cloudflare Worker serves the SPA (static assets from `dist/`), the JSON API under `/api`, and the agent MCP endpoint under `/mcp`. Each doc has a `DocRoom` Durable Object that applies every write in order and pushes it to open editors over WebSocket. Data lives in D1 (`migrations/`).

T3 Code embeds the app in its Docs panel. `FRAME_ANCESTORS` in `wrangler.jsonc` lists the origins allowed to frame it (CSP `frame-ancestors`); every other origin gets a non-frameable page. `src/client/embedBridge.ts` and `src/shared/embed.ts` hold the postMessage protocol T3 Code uses to navigate the app and follow its location.

Only the owner signs in: any address in `OWNER_EMAILS` gets a 6-digit code by email (Resend). Agents and T3 Code use bearer tokens created under Settings.

## Local development

Wrangler is not a workspace dependency; use a global install (`npm i -g wrangler`).

```sh
cd apps/docs-cloud
vp build                                   # SPA into dist/
wrangler d1 migrations apply DB --local    # local D1 under .wrangler/
wrangler dev --port 8787
```

Without `RESEND_API_KEY`, sign-in codes are printed to the `wrangler dev` console. Rebuild with `vp build` (or `vp build --watch` in a second terminal) after client changes.

Tests: `vp test run apps/docs-cloud` from the repo root. Typecheck: `vp run --filter @t3tools/docs-cloud typecheck`.

## First deploy

1. `wrangler login`
2. `wrangler d1 create docs-cloud`, then put the printed id in `wrangler.jsonc` (`database_id`).
3. `wrangler secret put RESEND_API_KEY`, and verify the `EMAIL_FROM` domain in Resend.
4. Confirm `OWNER_EMAILS` in `wrangler.jsonc` (the Gmail address is still a placeholder).
5. `vp run --filter @t3tools/docs-cloud deploy` (builds, applies remote migrations, deploys). The `docs.upliftedconsulting.com` custom domain is created on deploy because the zone is in the same account.
