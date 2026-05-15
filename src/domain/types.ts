export const COLORS = ["red", "blue", "black", "orange"] as const;
export type TileColor = (typeof COLORS)[number];

export type RegularTile = {
  kind: "regular";
  id: string;
  color: TileColor;
  value: number;
  copy: 1 | 2;
};

export type JokerTile = {
  kind: "joker";
  id: string;
  copy: 1 | 2;
};

export type Tile = RegularTile | JokerTile;

export type MeldType = "run" | "group";

export type JokerAssignment = {
  jokerId: string;
  color: TileColor;
  value: number;
};

export type Meld = {
  id: string;
  tiles: Tile[];
  type?: MeldType;
  jokerAssignments?: JokerAssignment[];
};

export type GameState = {
  board: Meld[];
  hand: Tile[];
  isInitialMeldComplete: boolean;
  poolRemaining: number;
  updatedAt: string;
};

export type SolverMove = {
  kind: "play";
  board: Meld[];
  playedTiles: Tile[];
  score: number;
  note: string;
};

export type SolverDraw = {
  kind: "draw";
  reason: string;
};

export type SolverResult = SolverMove | SolverDraw;
