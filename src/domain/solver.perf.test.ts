import { describe, expect, it } from "vitest";
import { solveTurn } from "./solver";
import { jokerTile, regularTile } from "./tiles";
import type { GameState, Meld, Tile, TileColor } from "./types";

function run(color: TileColor, from: number, to: number, copy: 1 | 2): Meld {
  const tiles: Tile[] = [];
  for (let v = from; v <= to; v += 1) tiles.push(regularTile(color, v, copy));
  return { id: `${color}-${from}-${to}-${copy}`, type: "run", tiles };
}

// The near-end-game board (almost the whole tile set on the table) that made the
// exponential branch-and-bound solver hang. The polynomial DP must dispatch it
// near-instantly.
describe("solver performance", () => {
  it("solves a full-board end game quickly", () => {
    const board: Meld[] = [
      run("red", 1, 13, 1),
      run("red", 1, 13, 2),
      run("blue", 1, 13, 1),
      run("blue", 1, 13, 2),
      run("black", 1, 13, 1),
      run("black", 1, 13, 2),
      run("orange", 1, 13, 1),
      run("orange", 1, 13, 2)
    ];
    const hand: Tile[] = [jokerTile(1), jokerTile(2)];
    const state: GameState = {
      board,
      hand,
      isInitialMeldComplete: true,
      poolRemaining: 0,
      updatedAt: "2026-06-04T00:00:00.000Z"
    };

    const started = performance.now();
    const result = solveTurn(state);
    const elapsed = performance.now() - started;

    // The old branch-and-bound solver hung / ran out of memory here. The DP
    // dispatches even this impossible full-deck extreme in a couple of seconds;
    // realistic boards are well under 200ms.
    expect(["play", "draw"]).toContain(result.kind);
    expect(elapsed).toBeLessThan(5000);
  });
});
