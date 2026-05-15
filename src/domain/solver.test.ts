import { describe, expect, it } from "vitest";
import { sortMeldTiles, validateGroup, validateMeld, validateRun } from "./rules";
import { canUseAllTiles, solveTurn } from "./solver";
import { jokerTile, regularTile } from "./tiles";
import type { GameState } from "./types";

function state(overrides: Partial<GameState>): GameState {
  return {
    board: [],
    hand: [],
    isInitialMeldComplete: true,
    poolRemaining: 80,
    updatedAt: "2026-05-15T00:00:00.000Z",
    ...overrides
  };
}

describe("Rummikub rules", () => {
  it("detects valid runs", () => {
    const result = validateRun([
      regularTile("red", 4, 1),
      regularTile("red", 5, 1),
      regularTile("red", 6, 1)
    ]);

    expect(result.valid).toBe(true);
    expect(result.valid && result.type).toBe("run");
  });

  it("rejects non-consecutive runs", () => {
    const result = validateRun([
      regularTile("red", 4, 1),
      regularTile("red", 6, 1),
      regularTile("red", 7, 1)
    ]);

    expect(result.valid).toBe(false);
  });

  it("detects valid groups", () => {
    const result = validateGroup([
      regularTile("red", 8, 1),
      regularTile("blue", 8, 1),
      regularTile("black", 8, 1)
    ]);

    expect(result.valid).toBe(true);
    expect(result.valid && result.type).toBe("group");
  });

  it("rejects repeated group colors", () => {
    const result = validateGroup([
      regularTile("red", 8, 1),
      regularTile("red", 8, 2),
      regularTile("black", 8, 1)
    ]);

    expect(result.valid).toBe(false);
  });

  it("uses jokers in runs and groups", () => {
    const run = validateMeld([regularTile("blue", 9, 1), jokerTile(1), regularTile("blue", 11, 1)]);
    const group = validateMeld([regularTile("red", 5, 1), regularTile("blue", 5, 1), jokerTile(2)]);

    expect(run.valid).toBe(true);
    expect(run.valid && run.assignments).toEqual([{ jokerId: "joker-1", color: "blue", value: 10 }]);
    expect(group.valid).toBe(true);
    expect(group.valid && group.type).toBe("group");
  });

  it("sorts a run joker into the value it represents", () => {
    const sorted = sortMeldTiles([regularTile("red", 6, 1), jokerTile(1), regularTile("red", 4, 1)]);

    expect(sorted.map((tile) => tile.id)).toEqual(["red-4-1", "joker-1", "red-6-1"]);
  });

  it("sorts a group joker into the color it represents", () => {
    const sorted = sortMeldTiles([regularTile("orange", 9, 1), jokerTile(1), regularTile("red", 9, 1)]);

    expect(sorted.map((tile) => tile.id)).toEqual(["red-9-1", "joker-1", "orange-9-1"]);
  });

  it("sorts incomplete groups numerically while editing", () => {
    const sorted = sortMeldTiles([
      regularTile("red", 10, 1),
      regularTile("red", 2, 1),
      regularTile("red", 3, 1),
      regularTile("red", 4, 1)
    ]);

    expect(sorted.map((tile) => tile.id)).toEqual(["red-2-1", "red-3-1", "red-4-1", "red-10-1"]);
  });
});

describe("solver", () => {
  it("covers all tiles when the hand is fully playable", () => {
    expect(
      canUseAllTiles([
        regularTile("red", 1, 1),
        regularTile("red", 2, 1),
        regularTile("red", 3, 1),
        regularTile("blue", 7, 1),
        regularTile("black", 7, 1),
        regularTile("orange", 7, 1)
      ])
    ).toBe(true);
  });

  it("draws when no legal play exists", () => {
    const result = solveTurn(
      state({
        hand: [regularTile("red", 1, 1), regularTile("blue", 4, 1), regularTile("black", 9, 1)]
      })
    );

    expect(result.kind).toBe("draw");
  });

  it("preserves existing table tiles while playing hand tiles", () => {
    const boardTiles = [regularTile("red", 1, 1), regularTile("red", 2, 1), regularTile("red", 3, 1)];
    const result = solveTurn(
      state({
        board: [{ id: "board-1", tiles: boardTiles, type: "run" }],
        hand: [regularTile("red", 4, 1)]
      })
    );

    expect(result.kind).toBe("play");
    expect(result.kind === "play" && result.playedTiles.map((tile) => tile.id)).toEqual(["red-4-1"]);
  });

  it("enforces the 30-point initial meld threshold", () => {
    const tooSmall = solveTurn(
      state({
        isInitialMeldComplete: false,
        hand: [regularTile("red", 1, 1), regularTile("red", 2, 1), regularTile("red", 3, 1)]
      })
    );
    const enough = solveTurn(
      state({
        isInitialMeldComplete: false,
        hand: [regularTile("black", 10, 1), regularTile("black", 11, 1), regularTile("black", 12, 1)]
      })
    );

    expect(tooSmall.kind).toBe("draw");
    expect(enough.kind).toBe("play");
  });

  it("does not use table tiles to satisfy the initial meld", () => {
    const result = solveTurn(
      state({
        isInitialMeldComplete: false,
        board: [
          {
            id: "table-run",
            type: "run",
            tiles: [regularTile("red", 10, 1), regularTile("red", 11, 1), regularTile("red", 12, 1)]
          }
        ],
        hand: [regularTile("blue", 1, 1), regularTile("blue", 2, 1), regularTile("blue", 3, 1)]
      })
    );

    expect(result.kind).toBe("draw");
  });

  it("allows standard joker replacement only when the joker remains used on the table", () => {
    const result = solveTurn(
      state({
        board: [
          {
            id: "joker-run",
            type: "run",
            tiles: [regularTile("red", 4, 1), jokerTile(1), regularTile("red", 6, 1)]
          }
        ],
        hand: [regularTile("red", 5, 1), regularTile("blue", 7, 1), regularTile("black", 7, 1)]
      })
    );

    expect(result.kind).toBe("play");
    expect(result.kind === "play" && result.playedTiles.map((tile) => tile.id).sort()).toEqual([
      "black-7-1",
      "blue-7-1",
      "red-5-1"
    ]);
    expect(result.kind === "play" && result.board.flatMap((meld) => meld.tiles).some((tile) => tile.id === "joker-1")).toBe(true);
  });

  it("returns a board error instead of searching an invalid table", () => {
    const result = solveTurn(
      state({
        board: [
          {
            id: "long-red-run-1",
            type: "run",
            tiles: [
              regularTile("red", 2, 1),
              regularTile("red", 4, 1),
              regularTile("red", 5, 1),
              regularTile("red", 6, 1),
              regularTile("red", 7, 1),
              regularTile("red", 8, 1),
              regularTile("red", 9, 1),
              regularTile("red", 10, 1),
              regularTile("red", 11, 1),
              regularTile("red", 12, 1),
              regularTile("red", 3, 1)
            ]
          },
          {
            id: "long-red-run-2",
            type: "run",
            tiles: [
              regularTile("red", 1, 2),
              regularTile("red", 2, 2),
              regularTile("red", 3, 2),
              regularTile("red", 4, 2),
              regularTile("red", 5, 2),
              jokerTile(2),
              regularTile("red", 7, 2),
              regularTile("red", 8, 2)
            ]
          },
          {
            id: "elevens",
            type: "group",
            tiles: [regularTile("blue", 11, 1), regularTile("blue", 11, 2), regularTile("red", 11, 2)]
          }
        ],
        hand: [
          regularTile("blue", 1, 1),
          regularTile("blue", 4, 1),
          regularTile("orange", 3, 1),
          regularTile("red", 6, 2),
          regularTile("red", 9, 2),
          regularTile("red", 10, 2)
        ]
      })
    );

    expect(result).toEqual({
      kind: "draw",
      reason: "Fix the board before solving: Group 3: All run tiles must share the same color. Group colors cannot repeat."
    });
  });
});
