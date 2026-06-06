import { describe, expect, it } from "vitest";
import { jokerTile, regularTile } from "./tiles";
import { solveTurn } from "./solver";
import type { GameState, Meld } from "./types";

// A real end-game position (from a physical game) where DeepBlue can go out by
// playing all three hand tiles — but only via a value-losing rearrangement:
//   - drop blue 8 into the joker's 8-group (blue8/black8/orange8), freeing the joker
//   - use the freed joker as a blue 3 in a new run: blue1 - blue2 - joker(3)
// The winning line scores LESS than parking the joker as a 13, so an objective
// that maximizes board value misses it. The ongoing turn must maximize hand
// tiles played, so DeepBlue prefers going out.
const board: Meld[] = [
  { id: "G1", tiles: [regularTile("red", 1, 1), regularTile("red", 2, 1), regularTile("red", 3, 1)] },
  { id: "G2", tiles: [regularTile("blue", 1, 1), regularTile("blue", 2, 1), regularTile("blue", 3, 1)] },
  { id: "G3", tiles: [regularTile("orange", 2, 1), regularTile("orange", 3, 1), regularTile("orange", 4, 1)] },
  { id: "G4", tiles: [regularTile("black", 2, 1), regularTile("black", 3, 1), regularTile("black", 4, 1), regularTile("black", 5, 1)] },
  { id: "G5", tiles: [regularTile("red", 6, 1), regularTile("blue", 6, 1), regularTile("orange", 6, 1)] },
  { id: "G6", tiles: [regularTile("red", 7, 1), regularTile("blue", 7, 1), regularTile("orange", 7, 1)] },
  { id: "G7", tiles: [regularTile("blue", 5, 1), regularTile("blue", 6, 2), regularTile("blue", 7, 2)] },
  { id: "G8", tiles: [jokerTile(2), regularTile("black", 8, 1), regularTile("orange", 8, 1)] },
  { id: "G9", tiles: [regularTile("blue", 8, 1), regularTile("black", 8, 2), regularTile("orange", 8, 2)] },
  { id: "G10", tiles: [regularTile("blue", 10, 2), regularTile("black", 10, 1), regularTile("orange", 10, 1)] },
  { id: "G11", tiles: [regularTile("red", 11, 1), regularTile("black", 11, 1), regularTile("orange", 11, 1)] },
  { id: "G12", tiles: [regularTile("red", 7, 2), regularTile("red", 8, 1), regularTile("red", 9, 1), regularTile("red", 10, 1), regularTile("red", 11, 2)] },
  { id: "G13", tiles: [regularTile("blue", 9, 1), regularTile("blue", 10, 1), regularTile("blue", 11, 1)] },
  { id: "G14", tiles: [regularTile("red", 12, 1), regularTile("blue", 12, 1), regularTile("black", 12, 1)] },
  { id: "G15", tiles: [regularTile("red", 13, 1), regularTile("blue", 13, 1), regularTile("black", 13, 1)] },
  { id: "G16", tiles: [regularTile("red", 13, 2), regularTile("blue", 13, 2), regularTile("orange", 13, 1)] },
  { id: "G17", tiles: [regularTile("orange", 11, 2), regularTile("orange", 12, 1), regularTile("orange", 13, 2)] }
];

function state(): GameState {
  return {
    board: board.map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
    hand: [regularTile("blue", 1, 2), regularTile("blue", 2, 2), regularTile("blue", 8, 2)],
    isInitialMeldComplete: true,
    poolRemaining: 106,
    updatedAt: "2026-06-06T00:00:00.000Z"
  };
}

describe("end-game win", () => {
  it("plays all three hand tiles to go out", () => {
    const result = solveTurn(state());

    expect(result.kind).toBe("play");
    if (result.kind !== "play") return;

    // Going out: every hand tile is played.
    expect(result.playedTiles.map((t) => t.id).sort()).toEqual(["blue-1-2", "blue-2-2", "blue-8-2"]);

    // The joker (a table tile) must remain on the table somewhere.
    const jokerStillPlayed = result.board.flatMap((m) => m.tiles).some((t) => t.kind === "joker");
    expect(jokerStillPlayed).toBe(true);

    // Every original board tile is preserved in the new arrangement.
    const out = new Set(result.board.flatMap((m) => m.tiles).map((t) => t.id));
    for (const tile of board.flatMap((m) => m.tiles)) {
      expect(out.has(tile.id)).toBe(true);
    }
  });
});
