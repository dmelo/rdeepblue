import type { GameState } from "./types";

const STORAGE_KEY = "rummikub-deep-blue-state";

export function loadState(): GameState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function saveState(state: GameState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}
