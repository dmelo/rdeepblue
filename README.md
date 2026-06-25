# Rummikub Deep Blue

A client-only Rummikub helper for weekend games with family and friends.

The app lets a human operator mirror the physical board, keep track of DeepBlue's hand, and ask the solver what DeepBlue should play next. It is built for fun: the UI is intentionally tabletop-like, draggable, and a little dramatic.

## Features

- Track DeepBlue's hand and the shared board.
- Drag tiles between Add Tiles, DeepBlue Hand, and board groups.
- Persist every state change in `localStorage`.
- Validate board groups before solving.
- Suggest either a playable board rearrangement or a draw.
- Support standard Rummikub tiles: 4 colors, values 1-13, 2 copies, and 2 jokers.
- Enforce the 30-point initial meld rule.
- Optional Google Analytics and Sentry integration.

## Solver

The solver is a polynomial-time dynamic program (a port of the MAXSCORE algorithm) from:

Jan N. van Rijn, Frank W. Takes, Jonathan K. Vis, **The Complexity of Rummikub Problems**.
https://arxiv.org/abs/1604.07553

The referenced paper is also included at `docs/1604.07553v1.pdf`. It processes tile
values 1→13 with per-suit run state, so it stays fast even on full late-game
boards. Jokers are scored at the value they represent. The earlier
brute-force solver is retained only as a test oracle.

## Tech Stack

- TypeScript
- React
- Vite
- pnpm
- Vitest

## Local Development

Use the pinned package manager through Corepack:

```bash
corepack pnpm install
corepack pnpm dev
```

Vite will print the local URL, usually:

```text
http://127.0.0.1:5173/
```

## Build

```bash
corepack pnpm build
```

The static site is emitted to `dist/`.

## Test

```bash
corepack pnpm test
```

## Security Posture

This repo uses pnpm with conservative supply-chain settings:

- exact direct dependency versions
- committed `pnpm-lock.yaml`
- `minimumReleaseAge: 10080`
- `blockExoticSubdeps: true`
- explicit lifecycle-script allowlist for `esbuild`

Check advisories with:

```bash
corepack pnpm audit
```

## Environment Variables

Create a local `.env` file if you want analytics or error reporting:

```env
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_APP_ENV=production
```

Only `VITE_GA_MEASUREMENT_ID` is required for Google Analytics. Sentry is disabled unless `VITE_SENTRY_DSN` is set.

Do not commit `.env`.

## Deploy

This is a static site. Any static host works.

For Netlify:

```bash
corepack pnpm build
```

Then publish `dist/`, or connect the Git repository and configure:

```text
Build command: corepack pnpm install --frozen-lockfile && corepack pnpm build
Publish directory: dist
```

Add the same environment variables in Netlify before building if you want GA or Sentry in production.

### Continuous deployment (release-gated)

`.github/workflows/deploy.yml` deploys to Netlify production **only when a GitHub
Release is published** (or via the manual "Run workflow" button). It checks out the
exact tagged commit, builds, and uploads `dist/` with the Netlify CLI. A plain push
to `main` does not go live.

One-time setup:

1. **Turn off Netlify's git auto-publish** so pushes don't deploy: in Netlify →
   Site configuration → Build & deploy → Continuous deployment, stop builds / disable
   auto-publishing (or disconnect the Git repo). The CLI deploy still works because it
   uploads a prebuilt `dist/` rather than triggering a Netlify build.
2. **Add GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions):
   - `NETLIFY_AUTH_TOKEN` — Netlify personal access token (Netlify → User settings → Applications → New access token).
   - `NETLIFY_SITE_ID` — the site's API ID (Netlify → Site configuration → General → Site information).
   - `VITE_GA_MEASUREMENT_ID` — e.g. `G-LN783FGJC9` (needed for `trackEvent`; the static tag in `index.html` works regardless).
   - `VITE_SENTRY_DSN` — optional.

To release: `git tag vX.Y.Z && git push --tags`, then publish a Release for that tag on
GitHub (or use the GitHub UI to create the tag and release together).
