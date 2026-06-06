# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **client-only** Rummikub helper. A human operator sits between a physical board and the UI: they mirror the opponent's moves into the app, track DeepBlue's hand, then ask the solver what DeepBlue should play. The solver returns either a board rearrangement (tiles to play + target groups) or a draw instruction. No backend — state lives entirely in `localStorage`, deployed as static assets.

See `SPEC.md` for the product intent and `README.md` for setup/deploy details.

## Commands

The package manager is pinned (`pnpm@10.33.4`); run everything through Corepack:

```bash
corepack pnpm install          # install deps (use --frozen-lockfile in CI)
corepack pnpm dev              # Vite dev server, usually http://127.0.0.1:5173/
corepack pnpm build            # tsc typecheck + vite build → dist/
corepack pnpm test             # vitest run (one-shot)
corepack pnpm test:watch       # vitest in watch mode
corepack pnpm audit            # supply-chain advisory check
```

Run a single test by name or file:

```bash
corepack pnpm exec vitest run -t "detects valid runs"
corepack pnpm exec vitest run src/domain/solver.test.ts
```

There is no separate lint step; `build` runs `tsc` (strict mode) as the typecheck gate.

## Architecture

The codebase is split into a **pure domain layer** and a **thin UI layer**. The domain has zero React imports and is the part worth understanding first.

### Domain (`src/domain/`) — the core

- **`types.ts`** — the data model. A `Tile` is either a `RegularTile` (color + value 1–13 + copy 1|2) or a `JokerTile` (copy only — jokers carry *no* color/value). A `Meld` holds tiles plus an optional resolved `type` and `jokerAssignments`. `GameState` (board + hand + flags) is what gets persisted. `SolverResult` is a discriminated union of `SolverMove` (`kind: "play"`) and `SolverDraw` (`kind: "draw"`).
- **`tiles.ts`** — tile factory and ordering. `createFullTileSet()` produces the canonical 106 tiles. **Tile IDs are deterministic and stable** (`${color}-${value}-${copy}`, `joker-${copy}`), which is the linchpin of the whole app: a `Set<id>` tracks what's placed and the picker hides used tiles. The solver collapses tiles into per-`(color,value)` counts to run, then maps the abstract result back to concrete tile IDs during reconstruction.
- **`rules.ts`** — meld legality. `validateRun` / `validateGroup` / `validateMeld` return a tagged result that, when valid, also computes `jokerAssignments` (the concrete color/value each joker stands for), `score` (sum of regular tile values), and `meldValue` (total including joker positions). `sortMeldTiles` orders tiles for display by resolving joker assignments. `validateBoard` collects per-group errors. (`validateMeld` resolves a joker to its *lowest* legal value and prefers a run reading — the solver does not rely on it for scoring; see below.)
- **`solver.ts`** — `solveTurn(state)`, the single entrypoint, plus `canUseAllTiles`. Thin wrapper over the DP in `solverDp.ts` that handles the two game modes and assembles a `SolverResult`. See below.
- **`solverDp.ts`** — the actual algorithm: a polynomial dynamic program (`dpSolve` / `dpMaxValue`). This is a port of the MAXSCORE algorithm from Rijn, Takes & Vis (`docs/1604.07553v1.pdf`).
- **`solverBruteForce.ts`** — the old exponential branch-and-bound solver, kept **only as the differential-testing oracle** (`bfMaxValue`). Not used at runtime.
- **`storage.ts`** — `localStorage` get/set/clear under one key. (Not covered by tests; vitest runs in the `node` environment, so only pure logic is tested.)

### Solver model (`solver.ts` + `solverDp.ts`)

`solveTurn` operates in two distinct modes:

1. **Initial meld not yet complete** — find melds from the **hand only** totaling **≥ 30**. Table tiles must *not* be used; the new melds are appended to the board. Draw if unreachable.
2. **Ongoing play** — pool hand + all board tiles, require **every existing board tile stays played** (passed to the DP as `requiredIds`), and maximize total value. If the best arrangement plays no hand tile, it's a draw.

Before either mode, the current board is validated; an invalid board short-circuits to a draw listing the errors.

The DP (`solverDp.ts`) processes tile values 1→13. Its state is, per suit, the two open runs — each bucketed to length `{0,1,2,3+}` plus flags for *holds a board tile* (the table constraint: abandoning such a run is infeasible) and *pending joker count* — together with a count of jokers already landed in completed melds. Groups are formed from the tiles left over at each value (precomputed `groupFrontier`). `DpSolver.dp` is the memoized scorer; `DpSolver.reconstruct` replays the optimal transitions to materialize concrete `Meld`s and the played tiles. Complexity is polynomial (effectively linear in the 13 values for fixed suits/copies), versus the old exponential search that hung on full late-game boards.

Two important semantic notes: jokers score their **represented value** (so the DP's `score` == `meldValue`, and a joker in a run is reported at the value it fills, maximizing) — this differs from `rules.ts`/`validateMeld`, which assign jokers low; the solver output carries its own `jokerAssignments` and does not pass through `sortMeldTiles`. And a joker only counts as "used" when its run **completes** (pending-joker tracking), which is what makes the board-joker constraint correct. The DP is validated against the brute-force oracle by `solverDp.diff.test.ts` (random inputs, identical max value) and `solverDp.reconstruct.test.ts` (legal melds, right tiles, values summing to the DP score).

### UI (`src/ui/App.tsx`)

A single component holds all game state. Tiles move between three drop zones — the **Add Tiles** picker, **DeepBlue Hand**, and **board groups** — via both click-select and HTML5 drag-and-drop (drag payload type `application/x-rummikub-tile`). Every mutation goes through `updateState`, which clears any stale solver result and stamps `updatedAt`; a `useEffect` persists on every change. "Apply solver board" writes the solver's proposed board back into state and marks the initial meld complete. Styling is hand-written in `src/ui/styles.css`.

### Observability (`src/observability/`)

`analytics.ts` (Google Analytics via injected gtag) and `sentry.ts` both **no-op unless their `VITE_*` env var is set**, so they're inert in local dev by default. `main.tsx` initializes both and wraps `App` in a Sentry error boundary.

## Conventions & constraints

- **Keep game logic in `src/domain/` and framework-free.** It must remain importable and testable without React. New rules/solver behavior belong here with colocated `*.test.ts` coverage; the UI should only orchestrate.
- **Preserve deterministic tile IDs.** Code throughout assumes IDs uniquely and reproducibly identify tiles.
- **Supply-chain posture is deliberate** (see `pnpm-workspace.yaml` / `README.md`): exact dependency versions, committed lockfile, `blockExoticSubdeps`, `minimumReleaseAge`, and an explicit build-script allowlist (`esbuild` only). Don't loosen these or add wide version ranges casually.
- Env vars are Vite-style (`VITE_*`, read via `import.meta.env`). Never commit `.env`.
