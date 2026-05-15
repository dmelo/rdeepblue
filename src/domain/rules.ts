import { COLORS, type JokerAssignment, type Meld, type Tile, type TileColor } from "./types";

type ConcreteTile = {
  tile: Tile;
  color: TileColor;
  value: number;
  isJoker: boolean;
};

export type MeldValidation =
  | {
      valid: true;
      type: "run" | "group";
      assignments: JokerAssignment[];
      score: number;
      meldValue: number;
    }
  | {
      valid: false;
      reason: string;
    };

function regulars(tiles: Tile[]) {
  return tiles.filter((tile) => tile.kind === "regular");
}

function jokers(tiles: Tile[]) {
  return tiles.filter((tile) => tile.kind === "joker");
}

function key(color: TileColor, value: number) {
  return `${color}-${value}`;
}

function colorRank(color: TileColor) {
  return COLORS.indexOf(color);
}

function compareLooseTiles(a: Tile, b: Tile) {
  if (a.kind === "joker" && b.kind === "joker") {
    return a.copy - b.copy;
  }
  if (a.kind === "joker") {
    return 1;
  }
  if (b.kind === "joker") {
    return -1;
  }
  if (a.value !== b.value) {
    return a.value - b.value;
  }
  if (a.color !== b.color) {
    return colorRank(a.color) - colorRank(b.color);
  }
  return a.copy - b.copy;
}

function hasDuplicateRegular(tiles: Tile[]) {
  const seen = new Set<string>();
  for (const tile of regulars(tiles)) {
    const tileKey = key(tile.color, tile.value);
    if (seen.has(tileKey)) {
      return true;
    }
    seen.add(tileKey);
  }
  return false;
}

export function validateGroup(tiles: Tile[]): MeldValidation {
  if (tiles.length < 3 || tiles.length > 4) {
    return { valid: false, reason: "A group must contain 3 or 4 tiles." };
  }

  const concrete = regulars(tiles);
  if (concrete.length === 0) {
    return { valid: false, reason: "A group needs at least one numbered tile." };
  }

  const value = concrete[0].value;
  if (!concrete.every((tile) => tile.value === value)) {
    return { valid: false, reason: "All group tiles must share the same value." };
  }

  const colors = new Set(concrete.map((tile) => tile.color));
  if (colors.size !== concrete.length) {
    return { valid: false, reason: "Group colors cannot repeat." };
  }

  const missingColors = COLORS.filter((color) => !colors.has(color));
  if (jokers(tiles).length > missingColors.length) {
    return { valid: false, reason: "Not enough distinct colors for the jokers." };
  }

  const assignments = jokers(tiles).map((tile, index) => ({
    jokerId: tile.id,
    color: missingColors[index],
    value
  }));

  return {
    valid: true,
    type: "group",
    assignments,
    score: concrete.reduce((sum, tile) => sum + tile.value, 0),
    meldValue: value * tiles.length
  };
}

export function validateRun(tiles: Tile[]): MeldValidation {
  if (tiles.length < 3) {
    return { valid: false, reason: "A run must contain at least 3 tiles." };
  }

  const concrete = regulars(tiles);
  if (concrete.length === 0) {
    return { valid: false, reason: "A run needs at least one numbered tile." };
  }

  const color = concrete[0].color;
  if (!concrete.every((tile) => tile.color === color)) {
    return { valid: false, reason: "All run tiles must share the same color." };
  }

  if (hasDuplicateRegular(tiles)) {
    return { valid: false, reason: "A run cannot contain duplicate values." };
  }

  const values = concrete.map((tile) => tile.value).sort((a, b) => a - b);
  const jokerCount = jokers(tiles).length;
  const runLength = tiles.length;

  for (let start = 1; start <= 14 - runLength; start += 1) {
    const needed = Array.from({ length: runLength }, (_, index) => start + index);
    const neededSet = new Set(needed);
    if (!values.every((value) => neededSet.has(value))) {
      continue;
    }

    const missing = needed.filter((value) => !values.includes(value));
    if (missing.length !== jokerCount) {
      continue;
    }

    const assignments = jokers(tiles).map((tile, index) => ({
      jokerId: tile.id,
      color,
      value: missing[index]
    }));

    return {
      valid: true,
      type: "run",
      assignments,
      score: concrete.reduce((sum, tile) => sum + tile.value, 0),
      meldValue: needed.reduce((sum, value) => sum + value, 0)
    };
  }

  return { valid: false, reason: "Run values must be consecutive, with jokers filling only gaps." };
}

export function validateMeld(tiles: Tile[]): MeldValidation {
  const run = validateRun(tiles);
  if (run.valid) {
    return run;
  }

  const group = validateGroup(tiles);
  if (group.valid) {
    return group;
  }

  return { valid: false, reason: `${run.reason} ${group.reason}` };
}

export function normalizeMeld(meld: Meld): Meld {
  const validation = validateMeld(meld.tiles);
  if (!validation.valid) {
    return { ...meld, type: undefined, jokerAssignments: [] };
  }
  return {
    ...meld,
    type: validation.type,
    jokerAssignments: validation.assignments
  };
}

export function sortMeldTiles(tiles: Tile[]): Tile[] {
  const validation = validateMeld(tiles);
  if (!validation.valid) {
    return [...tiles].sort(compareLooseTiles);
  }

  const assignments = new Map(validation.assignments.map((assignment) => [assignment.jokerId, assignment]));

  return [...tiles].sort((a, b) => {
    const aAssigned = a.kind === "joker" ? assignments.get(a.id) : undefined;
    const bAssigned = b.kind === "joker" ? assignments.get(b.id) : undefined;
    const aColor = a.kind === "regular" ? a.color : aAssigned?.color;
    const bColor = b.kind === "regular" ? b.color : bAssigned?.color;
    const aValue = a.kind === "regular" ? a.value : aAssigned?.value;
    const bValue = b.kind === "regular" ? b.value : bAssigned?.value;

    if (validation.type === "run") {
      if (aValue !== bValue) {
        return (aValue ?? 99) - (bValue ?? 99);
      }
      return a.id.localeCompare(b.id);
    }

    if (aColor !== bColor) {
      return colorRank(aColor ?? "orange") - colorRank(bColor ?? "orange");
    }
    return (aValue ?? 99) - (bValue ?? 99) || a.id.localeCompare(b.id);
  });
}

export function validateBoard(board: Meld[]): string[] {
  const errors: string[] = [];
  board.forEach((meld, index) => {
    const validation = validateMeld(meld.tiles);
    if (!validation.valid) {
      errors.push(`Group ${index + 1}: ${validation.reason}`);
    }
  });
  return errors;
}

export function concreteTileOptions(tile: Tile): ConcreteTile[] {
  if (tile.kind === "regular") {
    return [{ tile, color: tile.color, value: tile.value, isJoker: false }];
  }
  return COLORS.flatMap((color) =>
    Array.from({ length: 13 }, (_, index) => ({
      tile,
      color,
      value: index + 1,
      isJoker: true
    }))
  );
}
