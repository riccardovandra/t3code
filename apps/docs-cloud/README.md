# Docs Cloud

A hosted doc editor that T3 Code embeds in its Docs panel, and that anyone can run on their own Cloudflare account. One Cloudflare Worker serves the SPA (static assets from `dist/`), the JSON API under `/api`, and the agent MCP endpoint under `/mcp`. Each doc has a `DocRoom` Durable Object that applies every write in order and pushes it to open editors over WebSocket. Data lives in D1 (`migrations/`), doc images in R2.

`FRAME_ANCESTORS` in `wrangler.jsonc` lists the origins allowed to frame the app (CSP `frame-ancestors`); every other origin gets a non-frameable page. `src/client/embedBridge.ts` and `src/shared/embed.ts` hold the postMessage protocol T3 Code uses to navigate the app and follow its location.

Sign-in is a 6-digit code by email (Resend). Every address in `OWNER_EMAILS` signs in as the one admin user, who owns everything created before sharing existed and is the only one who creates projects. Anyone else can sign in once a doc has been shared with their address. Docs are private to their members, each an owner, editor, commenter or viewer (`src/shared/access.ts`); the checks live in `src/worker/access.ts`. Agents and T3 Code use bearer tokens created under Settings, and act as the person who created the token.

## Local development

Wrangler is not a workspace dependency; use a global install (`npm i -g wrangler`).

```sh
cd apps/docs-cloud
vp run dev    # builds the SPA, applies local D1 migrations, starts wrangler dev on :8787
```

`wrangler.jsonc` holds local values: sign in as `owner@example.com`, and the code is printed to the `wrangler dev` console. Override any var in `.dev.vars` (gitignored), such as `OWNER_EMAILS=you@example.com`, or `PUBLIC_ORIGIN=http://localhost:<port>` on another port. Rebuild with `vp build` (or `vp build --watch` in a second terminal) after client changes.

Tests: `vp test run apps/docs-cloud` from the repo root. Typecheck: `vp run --filter @t3tools/docs-cloud typecheck`.

## Self-hosting

You need a Cloudflare account with a domain on it, and a [Resend](https://resend.com) account with a verified sending domain.

1. Authenticate wrangler: `wrangler login`, or export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Create the storage once, from `apps/docs-cloud`:
   ```sh
   wrangler d1 create docs-cloud              # note the database_id it prints
   wrangler r2 bucket create docs-cloud-images
   ```
3. Copy `deploy.env.example` to `deploy.env` (gitignored) and fill it in: `PUBLIC_ORIGIN` (its host becomes the Worker's custom domain), `OWNER_EMAILS`, `EMAIL_FROM`, `D1_DATABASE_ID`, and optionally `HUB_URL`, a page the admin's home links back to. Variables already set in the environment win over the file.
4. `vp run --filter @t3tools/docs-cloud deploy` builds, writes `wrangler.deploy.json` from `wrangler.jsonc` plus `deploy.env`, applies remote migrations and deploys. Append `--dry-run` to check the config without deploying.
5. Store the Resend key: `wrangler secret put RESEND_API_KEY`.
6. Open your `PUBLIC_ORIGIN`, sign in with an owner address, and create an API token under Settings.
7. In T3 Code, open Settings -> MCP servers, enter your `PUBLIC_ORIGIN` and the token under Docs Cloud, and connect. Agents get the docs tools and the Docs panel shows your docs.

If you serve T3 Code from an origin that `FRAME_ANCESTORS` does not cover, add it there before deploying.

To rotate the email key: `wrangler secret put RESEND_API_KEY`. The `EMAIL_FROM` domain must stay verified in Resend.
