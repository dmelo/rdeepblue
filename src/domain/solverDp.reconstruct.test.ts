import { describe, expect, it } from "vitest";
import { COLORS, type Tile, type TileColor } from "./types";
import { jokerTile, regularTile } from "./tiles";
import { dpMaxValue, dpSolve, type DpMeld } from "./solverDp";

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

function randomSample(rand: () => number, maxTiles: number, density: number) {
  const tiles: Tile[] = [];
  const required = new Set<string>();
  const push = (tile: Tile) => {
    tiles.push(tile);
    if (rand() < 0.5) required.add(tile.id);
  };
  for (const color of COLORS) {
    for (let value = 1; value <= 13; value += 1) {
      const roll = rand();
      const copies = roll < 1 - density ? 0 : roll < 1 - density / 4 ? 1 : 2;
      for (let copy = 1 as 1 | 2; copy <= copies; copy = (copy + 1) as 1 | 2) {
        if (tiles.length < maxTiles) push(regularTile(color, value, copy));
      }
    }
  }
  const jr = rand();
  const jokers = jr < 0.7 ? 0 : jr < 0.92 ? 1 : 2;
  for (let copy = 1 as 1 | 2; copy <= jokers; copy = (copy + 1) as 1 | 2) {
    if (tiles.length < maxTiles) push(jokerTile(copy));
  }
  return { tiles, required };
}

// Resolve each tile in a meld to a concrete (color, value) using the meld's
// joker assignments, then confirm it is a legal run or group worth meldValue.
function checkMeld(meld: DpMeld): string | null {
  const assign = new Map(meld.jokerAssignments.map((a) => [a.jokerId, a]));
  const resolved: Array<{ color: TileColor; value: number }> = [];
  for (const tile of meld.tiles) {
    if (tile.kind === "regular") {
      resolved.push({ color: tile.color, value: tile.value });
    } else {
      const a = assign.get(tile.id);
      if (!a) return `joker ${tile.id} has no assignment`;
      resolved.push({ color: a.color, value: a.value });
    }
  }
  const valueSum = resolved.reduce((s, r) => s + r.value, 0);
  if (valueSum !== meld.meldValue) return `meldValue ${meld.meldValue} != value sum ${valueSum}`;

  if (meld.type === "group") {
    if (resolved.length < 3 || resolved.length > 4) return "group size out of range";
    const value = resolved[0].value;
    if (!resolved.every((r) => r.value === value)) return "group values differ";
    const colors = new Set(resolved.map((r) => r.color));
    if (colors.size !== resolved.length) return "group colors repeat";
    return null;
  }

  if (resolved.length < 3) return "run too short";
  const color = resolved[0].color;
  if (!resolved.every((r) => r.color === color)) return "run colors differ";
  const values = resolved.map((r) => r.value).sort((x, y) => x - y);
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== values[i - 1] + 1) return "run not consecutive";
  }
  return null;
}

describe("DP reconstruction", () => {
  it("produces legal melds that use the right tiles and sum to the DP score", () => {
    const rand = mulberry32(0x5EED);
    const problems: string[] = [];
    const profiles = [
      { cases: 2500, maxTiles: 12, density: 0.2 },
      { cases: 2000, maxTiles: 12, density: 0.45 }
    ];

    for (const profile of profiles) {
      for (let i = 0; i < profile.cases && problems.length < 5; i += 1) {
        const { tiles, required } = randomSample(rand, profile.maxTiles, profile.density);
        const expected = dpMaxValue(tiles, required, 0);
        const solved = dpSolve(tiles, required, 0);

        if (expected === null) {
          if (solved !== null) problems.push(`expected infeasible but got a solution`);
          continue;
        }
        if (solved === null) {
          problems.push(`expected ${expected} but reconstruction returned null`);
          continue;
        }

        const sum = solved.melds.reduce((s, m) => s + m.meldValue, 0);
        if (sum !== expected || solved.meldValue !== expected) {
          problems.push(`score mismatch: dp=${expected} reported=${solved.meldValue} sum=${sum}`);
          continue;
        }

        const used = new Map<string, number>();
        for (const meld of solved.melds) {
          const err = checkMeld(meld);
          if (err) {
            problems.push(`illegal meld (${err}) tiles=[${meld.tiles.map((t) => t.id).join(",")}]`);
            break;
          }
          for (const tile of meld.tiles) used.set(tile.id, (used.get(tile.id) ?? 0) + 1);
        }

        const inputIds = new Set(tiles.map((t) => t.id));
        for (const [id, count] of used) {
          if (count > 1) problems.push(`tile ${id} used ${count} times`);
          if (!inputIds.has(id)) problems.push(`unknown tile ${id} in output`);
        }
        for (const id of required) {
          if (!used.has(id)) problems.push(`board tile ${id} not preserved`);
        }
        if (problems.length >= 5) break;
      }
    }

    expect(problems).toEqual([]);
  }, 60000);
});
