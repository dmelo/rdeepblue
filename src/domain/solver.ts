import { COLORS, type GameState, type Meld, type SolverResult, type Tile, type TileColor } from "./types";
import { sumTileScore, tileSortKey } from "./tiles";
import { sortMeldTiles, validateBoard, validateMeld } from "./rules";

type Candidate = {
  id: string;
  type: "run" | "group";
  tiles: Tile[];
  score: number;
  meldValue: number;
};

type SearchState = {
  candidates: Candidate[];
  chosen: Candidate[];
  used: Set<string>;
  score: number;
  meldValue: number;
};

function makeMeldId(index: number) {
  return `solution-${index + 1}`;
}

function jokerAssignmentsFor(tiles: Tile[]) {
  const validation = validateMeld(tiles);
  return validation.valid ? validation.assignments : [];
}

function tileSignature(tile: Tile) {
  return tile.id;
}

function candidateKey(type: string, tiles: Tile[]) {
  return `${type}:${tiles.map(tileSignature).sort().join("|")}`;
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

function regularTilesByValue(tiles: Tile[], value: number) {
  return tiles.filter((tile) => tile.kind === "regular" && tile.value === value);
}

function regularTilesByColorValue(tiles: Tile[], color: TileColor, value: number) {
  return tiles.filter((tile) => tile.kind === "regular" && tile.color === color && tile.value === value);
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
              const validation = validateMeld(candidateTiles);
              if (!validation.valid || validation.type !== "group") {
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

function cartesian<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>(
    (accumulator, set) => accumulator.flatMap((prefix) => set.map((item) => [...prefix, item])),
    [[]]
  );
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
        for (const product of cartesian(choiceSets)) {
          const regulars = product.filter((tile): tile is Tile => tile !== undefined);
          for (const jokerCombination of combinations(jokers, missing)) {
            const candidateTiles = [...regulars, ...jokerCombination];
            const validation = validateMeld(candidateTiles);
            if (!validation.valid || validation.type !== "run") {
              continue;
            }
            const key = candidateKey("run", candidateTiles);
            if (!seen.has(key)) {
              seen.add(key);
              candidates.push({ id: key, type: "run", tiles: candidateTiles, score: validation.score, meldValue: validation.meldValue });
            }
          }
        }
      }
    }
  }

  return candidates;
}

export function generateMeldCandidates(tiles: Tile[]): Candidate[] {
  return [...generateRunCandidates(tiles), ...generateGroupCandidates(tiles)].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.id.localeCompare(b.id);
  });
}

function highestPossibleRemaining(candidates: Candidate[], startIndex: number, used: Set<string>) {
  let total = 0;
  const localUsed = new Set(used);
  for (let index = startIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.tiles.every((tile) => !localUsed.has(tile.id))) {
      candidate.tiles.forEach((tile) => localUsed.add(tile.id));
      total += candidate.score;
    }
  }
  return total;
}

function searchBest(candidates: Candidate[], requiredTileIds: Set<string>, minMeldValue: number): SearchState | null {
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
    { index: 0, state: { candidates, chosen: [], used: new Set(), score: 0, meldValue: 0 } }
  ];
  const seen = new Map<string, number>();

  while (stack.length > 0) {
    const { index, state } = stack.pop()!;

    if (best && state.score + highestPossibleRemaining(candidates, index, state.used) <= best.score) {
      continue;
    }

    const seenKey = `${index}:${[...state.used].sort().join(",")}:${state.meldValue}`;
    const seenScore = seen.get(seenKey);
    if (seenScore !== undefined && seenScore >= state.score) {
      continue;
    }
    seen.set(seenKey, state.score);

    if (index >= candidates.length) {
      if (!isRequiredCovered(state.used) || state.meldValue < minMeldValue) {
        continue;
      }
      if (!best || state.score > best.score) {
        best = {
          candidates,
          chosen: state.chosen,
          used: new Set(state.used),
          score: state.score,
          meldValue: state.meldValue
        };
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
          candidates,
          chosen: [...state.chosen, candidate],
          used: nextUsed,
          score: state.score + candidate.score,
          meldValue: state.meldValue + candidate.meldValue
        }
      });
    }
  }

  return best;
}

export function solveTurn(state: GameState): SolverResult {
  const boardErrors = validateBoard(state.board.filter((meld) => meld.tiles.length > 0));
  if (boardErrors.length > 0) {
    return {
      kind: "draw",
      reason: `Fix the board before solving: ${boardErrors.join(" ")}`
    };
  }

  const boardTiles = state.board.flatMap((meld) => meld.tiles);
  const currentBoardScore = sumTileScore(boardTiles);

  if (!state.isInitialMeldComplete) {
    const candidates = generateMeldCandidates(state.hand);
    const best = searchBest(candidates, new Set(), 30);
    if (!best) {
      return {
        kind: "draw",
        reason: "No legal initial meld reaches 30 points without using table tiles."
      };
    }

    const playedTiles = state.hand.filter((tile) => best.used.has(tile.id)).sort((a, b) => tileSortKey(a).localeCompare(tileSortKey(b)));
    const newMelds: Meld[] = best.chosen.map((candidate, index) => ({
      id: makeMeldId(index),
      type: candidate.type,
      tiles: sortMeldTiles(candidate.tiles),
      jokerAssignments: jokerAssignmentsFor(candidate.tiles)
    }));

    return {
      kind: "play",
      board: [...state.board.filter((meld) => meld.tiles.length > 0), ...newMelds],
      playedTiles,
      score: best.meldValue,
      note: "This satisfies the 30-point initial meld without using existing table tiles."
    };
  }

  const allTiles = [...boardTiles, ...state.hand];
  const requiredBoardTileIds = new Set(boardTiles.map((tile) => tile.id));
  const candidates = generateMeldCandidates(allTiles);
  const best = searchBest(candidates, requiredBoardTileIds, currentBoardScore + 1);

  if (!best) {
    return {
      kind: "draw",
      reason: "No legal play improves the board while preserving every table tile."
    };
  }

  const playedTiles = state.hand.filter((tile) => best.used.has(tile.id)).sort((a, b) => tileSortKey(a).localeCompare(tileSortKey(b)));
  if (playedTiles.length === 0) {
    return {
      kind: "draw",
      reason: "The best legal arrangement uses no DeepBlue hand tiles."
    };
  }

  const board: Meld[] = best.chosen.map((candidate, index) => ({
    id: makeMeldId(index),
    type: candidate.type,
    tiles: sortMeldTiles(candidate.tiles),
    jokerAssignments: jokerAssignmentsFor(candidate.tiles)
  }));

  return {
    kind: "play",
    board,
    playedTiles,
    score: best.score - currentBoardScore,
    note: state.isInitialMeldComplete
      ? "Play these hand tiles and rearrange the board into the target groups."
      : "This satisfies the 30-point initial meld and preserves the table."
  };
}

export function canUseAllTiles(tiles: Tile[]) {
  const candidates = generateMeldCandidates(tiles);
  const required = new Set(tiles.map((tile) => tile.id));
  return searchBest(candidates, required, 0) !== null;
}
