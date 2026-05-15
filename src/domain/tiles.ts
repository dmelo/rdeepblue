import { COLORS, type Tile, type TileColor } from "./types";

export function regularTile(color: TileColor, value: number, copy: 1 | 2): Tile {
  return {
    kind: "regular",
    id: `${color}-${value}-${copy}`,
    color,
    value,
    copy
  };
}

export function jokerTile(copy: 1 | 2): Tile {
  return {
    kind: "joker",
    id: `joker-${copy}`,
    copy
  };
}

export function createFullTileSet(): Tile[] {
  const tiles: Tile[] = [];
  for (const copy of [1, 2] as const) {
    for (const color of COLORS) {
      for (let value = 1; value <= 13; value += 1) {
        tiles.push(regularTile(color, value, copy));
      }
    }
    tiles.push(jokerTile(copy));
  }
  return tiles;
}

export function tileLabel(tile: Tile): string {
  return tile.kind === "joker" ? "Joker" : `${tile.value}`;
}

export function tileSortKey(tile: Tile): string {
  if (tile.kind === "joker") {
    return `z-${tile.copy}`;
  }
  return `${tile.color.padEnd(8, " ")}-${tile.value.toString().padStart(2, "0")}-${tile.copy}`;
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => tileSortKey(a).localeCompare(tileSortKey(b)));
}

export function tileScore(tile: Tile): number {
  return tile.kind === "regular" ? tile.value : 0;
}

export function sumTileScore(tiles: Tile[]): number {
  return tiles.reduce((sum, tile) => sum + tileScore(tile), 0);
}
