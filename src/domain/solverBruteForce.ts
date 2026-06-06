// Exponential branch-and-bound solver. Correct but slow on large boards.
// Retained as the differential-testing oracle for the polynomial DP in solver.ts.
import { COLORS, type Tile, type TileColor } from "./types";
import { validateGroup } from "./rules";

type Candidate = {
  id: string;
  type: "run" | "group";
  tiles: Tile[];
  score: number;
  meldValue: number;
};

type SearchState = {
  chosen: Candidate[];
  used: Set<string>;
  weight: number; // composite objective: meldValue + tileWeight * tilesUsed
};

function candidateKey(type: string, tiles: Tile[]) {
  return `${type}:${tiles.map((tile) => tile.id).sort().join("|")}`;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) {
    return [[]];
  }
  if (items.length < size) {
    return [];
  }

  const [head, ...tail] = items;
  return [
    ...combinations(tail, size - 1).map((combination) => [head, ...combination]),
    ...combinations(tail, size)
  ];
}

function regularTilesByColorValue(tiles: Tile[], color: TileColor, value: number) {
  return tiles.filter((tile) => tile.kind === "regular" && tile.color === color && tile.value === value);
}

function cartesian<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>(
    (accumulator, set) => accumulator.flatMap((prefix) => set.map((item) => [...prefix, item])),
    [[]]
  );
}

function generateGroupCandidates(tiles: Tile[]): Candidate[] {
  const jokers = tiles.filter((tile) => tile.kind === "joker");
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (let value = 1; value <= 13; value += 1) {
    const colorChoices = COLORS.map((color) => ({
      color,
      tiles: regularTilesByColorValue(tiles, color, value)
    })).filter((choice) => choice.tiles.length > 0);

    for (const size of [3, 4]) {
      for (let jokerCount = 0; jokerCount <= Math.min(jokers.length, size); jokerCount += 1) {
        const regularCount = size - jokerCount;
        if (regularCount < 1 || regularCount > colorChoices.length) {
          continue;
        }

        for (const colorCombination of combinations(colorChoices, regularCount)) {
          const tileOptions = colorCombination.map((choice) => choice.tiles);
          const products = cartesian(tileOptions);
          for (const product of products) {
            for (const jokerCombination of combinations(jokers, jokerCount)) {
              const candidateTiles = [...product, ...jokerCombination];
              // Use validateGroup directly: validateMeld would prefer a run
              // reading of the same tiles (e.g. value-13 + 2 jokers), hiding the
              // higher-value group interpretation.
              const validation = validateGroup(candidateTiles);
              if (!validation.valid) {
                continue;
              }
              const key = candidateKey("group", candidateTiles);
              if (!seen.has(key)) {
                seen.add(key);
                candidates.push({ id: key, type: "group", tiles: candidateTiles, score: validation.score, meldValue: validation.meldValue });
              }
            }
          }
        }
      }
    }
  }

  return candidates;
}

function generateRunCandidates(tiles: Tile[]): Candidate[] {
  const jokers = tiles.filter((tile) => tile.kind === "joker");
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const color of COLORS) {
    for (let start = 1; start <= 13; start += 1) {
      for (let end = start + 2; end <= 13; end += 1) {
        const needed = Array.from({ length: end - start + 1 }, (_, index) => start + index);
        const choices = needed.map((value) => regularTilesByColorValue(tiles, color, value));
        const missing = choices.filter((choice) => choice.length === 0).length;
        if (missing > jokers.length) {
          continue;
        }

        const choiceSets = choices.map((choice) => (choice.length > 0 ? choice : [undefined]));
        const meldValue = needed.reduce((sum, value) => sum + value, 0);
        for (const product of cartesian(choiceSets)) {
          const regulars = product.filter((tile): tile is Tile => tile !== undefined);
          const score = regulars.reduce((sum, tile) => sum + (tile.kind === "regular" ? tile.value : 0), 0);
          for (const jokerCombination of combinations(jokers, missing)) {
            const candidateTiles = [...regulars, ...jokerCombination];
            // Key by explicit range so the same tiles placed at different value
            // windows (joker resolved low vs high) are distinct candidates and the
            // search can choose the higher-value reading.
            const key = `run:${color}:${start}-${end}:${candidateTiles.map((tile) => tile.id).sort().join("|")}`;
            if (!seen.has(key)) {
              seen.add(key);
              candidates.push({ id: key, type: "run", tiles: candidateTiles, score, meldValue });
            }
          }
        }
      }
    }
  }

  return candidates;
}

export function bfGenerateMeldCandidates(tiles: Tile[]): Candidate[] {
  return [...generateRunCandidates(tiles), ...generateGroupCandidates(tiles)].sort((a, b) => {
    if (b.meldValue !== a.meldValue) {
      return b.meldValue - a.meldValue;
    }
    return a.id.localeCompare(b.id);
  });
}

function candidateWeight(candidate: Candidate, tileWeight: number) {
  return candidate.meldValue + candidate.tiles.length * tileWeight;
}

// Over-estimate of the objective still reachable from startIndex: the sum of
// every candidate that does not conflict with `used`, ignoring conflicts among
// those candidates. Ignoring conflicts only inflates the figure, so it is a true
// upper bound and safe to prune against.
function upperBoundRemaining(candidates: Candidate[], startIndex: number, used: Set<string>, tileWeight: number) {
  let total = 0;
  for (let index = startIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.tiles.every((tile) => !used.has(tile.id))) {
      total += candidateWeight(candidate, tileWeight);
    }
  }
  return total;
}

// Maximizes the composite objective (tileWeight * tilesUsed + meldValue; joker
// positions count at their represented value) subject to covering every required
// tile id. Exact oracle (sound upper-bound pruning only), run on small inputs.
function searchBest(candidates: Candidate[], requiredTileIds: Set<string>, tileWeight: number): SearchState | null {
  let best: SearchState | null = null;

  function isRequiredCovered(used: Set<string>) {
    for (const id of requiredTileIds) {
      if (!used.has(id)) {
        return false;
      }
    }
    return true;
  }

  const stack: Array<{ index: number; state: SearchState }> = [
    { index: 0, state: { chosen: [], used: new Set(), weight: 0 } }
  ];
  const seen = new Map<string, number>();

  while (stack.length > 0) {
    const { index, state } = stack.pop()!;

    if (best && state.weight + upperBoundRemaining(candidates, index, state.used, tileWeight) <= best.weight) {
      continue;
    }

    const seenKey = `${index}:${[...state.used].sort().join(",")}`;
    const seenScore = seen.get(seenKey);
    if (seenScore !== undefined && seenScore >= state.weight) {
      continue;
    }
    seen.set(seenKey, state.weight);

    if (index >= candidates.length) {
      if (!isRequiredCovered(state.used)) {
        continue;
      }
      if (!best || state.weight > best.weight) {
        best = { chosen: state.chosen, used: new Set(state.used), weight: state.weight };
      }
      continue;
    }

    const candidate = candidates[index];
    stack.push({ index: index + 1, state });

    if (candidate.tiles.every((tile) => !state.used.has(tile.id))) {
      const nextUsed = new Set(state.used);
      candidate.tiles.forEach((tile) => nextUsed.add(tile.id));
      stack.push({
        index: index + 1,
        state: {
          chosen: [...state.chosen, candidate],
          used: nextUsed,
          weight: state.weight + candidateWeight(candidate, tileWeight)
        }
      });
    }
  }

  return best;
}

// Differential-testing entrypoint: maximum composite objective achievable from
// `tiles` while using every tile in `requiredIds`. Null when no covering
// arrangement exists.
export function bfMaxValue(tiles: Tile[], requiredIds: Set<string>, tileWeight: number): number | null {
  const candidates = bfGenerateMeldCandidates(tiles);
  const best = searchBest(candidates, requiredIds, tileWeight);
  return best ? best.weight : null;
}

// True when every tile can be placed in valid melds simultaneously.
export function bfCanUseAllTiles(tiles: Tile[]): boolean {
  const required = new Set(tiles.map((tile) => tile.id));
  return bfMaxValue(tiles, required, 0) !== null;
}
