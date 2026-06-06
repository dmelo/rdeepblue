import type { GameState, Meld, SolverResult, Tile } from "./types";
import { tileSortKey } from "./tiles";
import { validateBoard, validateMeld } from "./rules";
import { dpCanUseAllTiles, dpSolve, type DpMeld } from "./solverDp";

const INITIAL_MELD_THRESHOLD = 30;

function makeMeldId(index: number) {
  return `solution-${index + 1}`;
}

function toMeld(dpMeld: DpMeld, index: number): Meld {
  return {
    id: makeMeldId(index),
    type: dpMeld.type,
    tiles: dpMeld.tiles,
    jokerAssignments: dpMeld.jokerAssignments
  };
}

function boardMeldValue(board: Meld[]): number {
  return board.reduce((sum, meld) => {
    const validation = validateMeld(meld.tiles);
    return sum + (validation.valid ? validation.meldValue : 0);
  }, 0);
}

export function solveTurn(state: GameState): SolverResult {
  const board = state.board.filter((meld) => meld.tiles.length > 0);
  const boardErrors = validateBoard(board);
  if (boardErrors.length > 0) {
    return {
      kind: "draw",
      reason: `Fix the board before solving: ${boardErrors.join(" ")}`
    };
  }

  if (!state.isInitialMeldComplete) {
    // The initial meld must reach 30 points using DeepBlue's hand alone; table
    // tiles stay put and the new melds are appended to the board.
    const result = dpSolve(state.hand, new Set(), INITIAL_MELD_THRESHOLD);
    if (!result) {
      return {
        kind: "draw",
        reason: "No legal initial meld reaches 30 points without using table tiles."
      };
    }

    const playedTiles = result.melds
      .flatMap((meld) => meld.tiles)
      .sort((a, b) => tileSortKey(a).localeCompare(tileSortKey(b)));

    return {
      kind: "play",
      board: [...board, ...result.melds.map((meld, index) => toMeld(meld, index))],
      playedTiles,
      score: result.meldValue,
      note: "This satisfies the 30-point initial meld without using existing table tiles."
    };
  }

  // Ongoing turn: every table tile must stay played, so we re-pool the board and
  // the hand and find the highest-value arrangement that uses all board tiles.
  const boardTiles = board.flatMap((meld) => meld.tiles);
  const requiredIds = new Set(boardTiles.map((tile) => tile.id));
  const allTiles = [...boardTiles, ...state.hand];
  const result = dpSolve(allTiles, requiredIds, 0);

  if (!result) {
    return {
      kind: "draw",
      reason: "No legal play improves the board while preserving every table tile."
    };
  }

  const playedTiles = result.melds
    .flatMap((meld) => meld.tiles)
    .filter((tile) => !requiredIds.has(tile.id))
    .sort((a, b) => tileSortKey(a).localeCompare(tileSortKey(b)));

  if (playedTiles.length === 0) {
    return {
      kind: "draw",
      reason: "The best legal arrangement uses no DeepBlue hand tiles."
    };
  }

  return {
    kind: "play",
    board: result.melds.map((meld, index) => toMeld(meld, index)),
    playedTiles,
    score: result.meldValue - boardMeldValue(board),
    note: "Play these hand tiles and rearrange the board into the target groups."
  };
}

export function canUseAllTiles(tiles: Tile[]): boolean {
  return dpCanUseAllTiles(tiles);
}
