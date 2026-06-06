import { describe, expect, it } from "vitest";
import { COLORS, type Tile } from "./types";
import { jokerTile, regularTile } from "./tiles";
import { bfMaxValue } from "./solverBruteForce";
import { dpMaxValue } from "./solverDp";

// Deterministic PRNG so failures reproduce.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Sample = { tiles: Tile[]; required: Set<string> };

// Random small board+hand: each cell 0..2 reals, 0..2 jokers, random board subset.
// `density` controls how often a cell is populated; higher exercises more
// overlapping runs/groups.
function randomSample(rand: () => number, maxTiles: number, density: number): Sample {
  const tiles: Tile[] = [];
  const required = new Set<string>();
  const pushMaybeBoard = (tile: Tile) => {
    tiles.push(tile);
    if (rand() < 0.5) required.add(tile.id);
  };

  for (const color of COLORS) {
    for (let value = 1; value <= 13; value += 1) {
      const roll = rand();
      const copies = roll < 1 - density ? 0 : roll < 1 - density / 4 ? 1 : 2;
      for (let copy = 1 as 1 | 2; copy <= copies; copy = (copy + 1) as 1 | 2) {
        if (tiles.length >= maxTiles) break;
        pushMaybeBoard(regularTile(color, value, copy));
      }
    }
  }
  const jokerRoll = rand();
  const jokerCount = jokerRoll < 0.7 ? 0 : jokerRoll < 0.92 ? 1 : 2;
  for (let copy = 1 as 1 | 2; copy <= jokerCount; copy = (copy + 1) as 1 | 2) {
    if (tiles.length >= maxTiles) break;
    pushMaybeBoard(jokerTile(copy));
  }

  return { tiles, required };
}

describe("DP scorer matches brute-force oracle", () => {
  it("agrees on the max objective across random small inputs", () => {
    const rand = mulberry32(0xC0FFEE);
    const mismatches: string[] = [];

    // Sparse (varied structure) and dense (more overlap) profiles.
    const profiles = [
      { cases: 3000, maxTiles: 12, density: 0.18 },
      { cases: 2500, maxTiles: 12, density: 0.45 }
    ];

    // tileWeight 0 = pure meldValue; 10000 = lexicographic (tiles played first).
    for (const profile of profiles) {
      for (let i = 0; i < profile.cases && mismatches.length < 5; i += 1) {
        const { tiles, required } = randomSample(rand, profile.maxTiles, profile.density);
        for (const tileWeight of [0, 10000]) {
          const bf = bfMaxValue(tiles, required, tileWeight);
          const dp = dpMaxValue(tiles, required, tileWeight);
          if (bf !== dp) {
            mismatches.push(
              `w=${tileWeight} bf=${bf} dp=${dp} required=[${[...required].sort().join(",")}] tiles=[${tiles
                .map((t) => t.id)
                .sort()
                .join(",")}]`
            );
            if (mismatches.length >= 5) break;
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  }, 60000);
});
