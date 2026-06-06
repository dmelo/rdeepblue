import { type DragEvent, useEffect, useMemo, useState } from "react";
import { sortMeldTiles, validateBoard } from "../domain/rules";
import { solveTurn } from "../domain/solver";
import { createFullTileSet, sortTiles, tileLabel } from "../domain/tiles";
import type { GameState, Meld, SolverResult, Tile, TileColor } from "../domain/types";
import { COLORS } from "../domain/types";
import { clearState, loadState, saveState } from "../domain/storage";
import { trackEvent } from "../observability/analytics";
import { captureException } from "../observability/sentry";

const emptyState = (): GameState => ({
  board: [{ id: crypto.randomUUID(), tiles: [] }],
  hand: [],
  isInitialMeldComplete: false,
  poolRemaining: 106,
  updatedAt: new Date().toISOString()
});

function touch(state: GameState): GameState {
  return { ...state, updatedAt: new Date().toISOString() };
}

const TILE_DRAG_TYPE = "application/x-rummikub-tile";

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function PlaceIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 3v11" />
      <path d="M7 9l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function Logo() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <span className="logo-tile logo-red">13</span>
      <span className="logo-tile logo-blue">7</span>
      <span className="logo-tile logo-black">J</span>
      <span className="logo-spark">DB</span>
    </div>
  );
}

function TileButton({
  tile,
  selected,
  dragging,
  draggable,
  onClick,
  onDragStart,
  onDragEnd
}: {
  tile: Tile;
  selected?: boolean;
  dragging?: boolean;
  draggable?: boolean;
  onClick: () => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
}) {
  const className = tile.kind === "joker" ? "tile joker" : `tile ${tile.color}`;
  return (
    <button
      className={`${className} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}`}
      draggable={draggable}
      type="button"
      onClick={onClick}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      <span>{tileLabel(tile)}</span>
      <small>{tile.kind === "joker" ? `#${tile.copy}` : tile.color[0].toUpperCase()}</small>
    </button>
  );
}

function TilePicker({
  usedIds,
  dragTarget,
  onAdd,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop
}: {
  usedIds: Set<string>;
  dragTarget: string | null;
  onAdd: (tile: Tile) => void;
  onDragEnd: () => void;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, tileId: string) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const [color, setColor] = useState<TileColor>("red");
  const [copy, setCopy] = useState<1 | 2>(1);
  const allTiles = useMemo(() => createFullTileSet(), []);
  const available = allTiles.filter((tile) => !usedIds.has(tile.id));

  const regularValues = Array.from({ length: 13 }, (_, index) => index + 1);
  const selectedCopyAvailable = (tile: Tile) => !usedIds.has(tile.id);

  return (
    <section
      className={`panel tile-picker drop-zone ${dragTarget === "add-tiles" ? "drop-active" : ""}`}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="panel-title">Add Tiles</div>
      <div className="segmented">
        {COLORS.map((option) => (
          <button className={option === color ? "active" : ""} key={option} type="button" onClick={() => setColor(option)}>
            {option}
          </button>
        ))}
      </div>
      <div className="segmented compact">
        {[1, 2].map((option) => (
          <button className={option === copy ? "active" : ""} key={option} type="button" onClick={() => setCopy(option as 1 | 2)}>
            copy {option}
          </button>
        ))}
      </div>
      <div className="tile-grid">
        {regularValues.map((value) => {
          const tile = available.find((candidate) => candidate.kind === "regular" && candidate.color === color && candidate.value === value && candidate.copy === copy);
          const disabledTile = createFullTileSet().find((candidate) => candidate.kind === "regular" && candidate.color === color && candidate.value === value && candidate.copy === copy)!;
          return (
            <button
              className={`tile ${color}`}
              disabled={!tile || !selectedCopyAvailable(disabledTile)}
              draggable={Boolean(tile)}
              key={value}
              type="button"
              onClick={() => tile && onAdd(tile)}
              onDragEnd={onDragEnd}
              onDragStart={(event) => tile && onDragStart(event, tile.id)}
            >
              <span>{value}</span>
              <small>{color[0].toUpperCase()}</small>
            </button>
          );
        })}
      </div>
      <div className="tile-grid jokers">
        {available
          .filter((tile) => tile.kind === "joker")
          .map((tile) => (
            <TileButton
              draggable
              key={tile.id}
              tile={tile}
              onClick={() => onAdd(tile)}
              onDragEnd={onDragEnd}
              onDragStart={(event) => onDragStart(event, tile.id)}
            />
          ))}
      </div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<GameState>(() => loadState() ?? emptyState());
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [draggingTileId, setDraggingTileId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const allTiles = useMemo(() => createFullTileSet(), []);

  useEffect(() => {
    saveState(state);
  }, [state]);

  // While dragging a tile, auto-scroll the page when the pointer hovers near the
  // top or bottom edge of the window — so a tile picked up high can be dropped on
  // a group further down without releasing it (touchpad-friendly).
  useEffect(() => {
    if (!draggingTileId) {
      return;
    }
    const EDGE = 110;
    const MAX_SPEED = 22;
    let pointerY = Number.NaN;
    let frame = 0;
    // globalThis.DragEvent is the DOM event (it has clientY); the bare DragEvent
    // name is shadowed by React's synthetic-event import in this file.
    const onDragOver = (event: globalThis.DragEvent) => {
      pointerY = event.clientY;
    };
    const step = () => {
      if (!Number.isNaN(pointerY)) {
        const height = window.innerHeight;
        let delta = 0;
        if (pointerY < EDGE) {
          delta = -MAX_SPEED * (1 - pointerY / EDGE);
        } else if (pointerY > height - EDGE) {
          delta = MAX_SPEED * (1 - (height - pointerY) / EDGE);
        }
        if (delta !== 0) {
          window.scrollBy(0, delta);
        }
      }
      frame = requestAnimationFrame(step);
    };
    window.addEventListener("dragover", onDragOver);
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      cancelAnimationFrame(frame);
    };
  }, [draggingTileId]);

  const usedIds = useMemo(() => new Set([...state.hand, ...state.board.flatMap((meld) => meld.tiles)].map((tile) => tile.id)), [state]);
  const boardErrors = validateBoard(state.board.filter((meld) => meld.tiles.length > 0));
  const selectedTile = [...state.hand, ...state.board.flatMap((meld) => meld.tiles)].find((tile) => tile.id === selectedTileId);

  function updateState(updater: (current: GameState) => GameState) {
    setSolverResult(null);
    setState((current) => touch(updater(current)));
  }

  function addTileToHand(tile: Tile) {
    updateState((current) => ({ ...current, hand: sortTiles([...current.hand, tile]) }));
  }

  function findTile(tileId: string) {
    return [...state.hand, ...state.board.flatMap((meld) => meld.tiles), ...allTiles].find((tile) => tile.id === tileId);
  }

  function isTileRecorded(tileId: string) {
    return usedIds.has(tileId);
  }

  function removeTile(tileId: string) {
    updateState((current) => ({
      ...current,
      hand: current.hand.filter((tile) => tile.id !== tileId),
      board: current.board.map((meld) => ({ ...meld, tiles: meld.tiles.filter((tile) => tile.id !== tileId) }))
    }));
    setSelectedTileId(null);
  }

  function moveSelectedToHand() {
    if (!selectedTile) {
      return;
    }
    moveTileToHand(selectedTile.id);
  }

  function moveTileToHand(tileId: string) {
    const tileToMove = findTile(tileId);
    if (!tileToMove) {
      return;
    }

    updateState((current) => ({
      ...current,
      board: current.board.map((meld) => ({ ...meld, tiles: meld.tiles.filter((tile) => tile.id !== tileId) })),
      hand: sortTiles([...current.hand.filter((tile) => tile.id !== tileId), tileToMove])
    }));
    setSelectedTileId(tileId);
  }

  function moveTileToMeld(tileId: string, meldId: string) {
    const tileToMove = findTile(tileId);
    if (!tileToMove) {
      return;
    }

    updateState((current) => ({
      ...current,
      hand: current.hand.filter((tile) => tile.id !== tileId),
      board: current.board.map((meld) => ({
        ...meld,
        tiles:
          meld.id === meldId
            ? sortMeldTiles([...meld.tiles.filter((tile) => tile.id !== tileId), tileToMove])
            : meld.tiles.filter((tile) => tile.id !== tileId)
      }))
    }));
    setSelectedTileId(tileId);
  }

  function returnTileToPicker(tileId: string) {
    if (!isTileRecorded(tileId)) {
      return;
    }

    removeTile(tileId);
  }

  function startTileDrag(event: DragEvent<HTMLButtonElement>, tileId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TILE_DRAG_TYPE, tileId);
    event.dataTransfer.setData("text/plain", tileId);
    setSelectedTileId(tileId);
    setDraggingTileId(tileId);
  }

  function allowTileDrop(event: DragEvent<HTMLElement>, targetId: string) {
    if (!draggingTileId && !event.dataTransfer.types.includes(TILE_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(targetId);
  }

  function leaveTileDrop(targetId: string) {
    setDragTarget((current) => (current === targetId ? null : current));
  }

  function droppedTileId(event: DragEvent<HTMLElement>) {
    return event.dataTransfer.getData(TILE_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
  }

  function dropTileOnHand(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const tileId = droppedTileId(event);
    if (tileId) {
      moveTileToHand(tileId);
    }
    setDraggingTileId(null);
    setDragTarget(null);
  }

  function dropTileOnMeld(event: DragEvent<HTMLElement>, meldId: string) {
    event.preventDefault();
    const tileId = droppedTileId(event);
    if (tileId) {
      moveTileToMeld(tileId, meldId);
    }
    setDraggingTileId(null);
    setDragTarget(null);
  }

  function dropTileOnPicker(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const tileId = droppedTileId(event);
    if (tileId) {
      returnTileToPicker(tileId);
    }
    setDraggingTileId(null);
    setDragTarget(null);
  }

  function endTileDrag() {
    setDraggingTileId(null);
    setDragTarget(null);
  }

  function addMeld() {
    updateState((current) => ({ ...current, board: [...current.board, { id: crypto.randomUUID(), tiles: [] }] }));
  }

  function removeMeld(meldId: string) {
    updateState((current) => {
      const meld = current.board.find((candidate) => candidate.id === meldId);
      return {
        ...current,
        hand: sortTiles([...current.hand, ...(meld?.tiles ?? [])]),
        board: current.board.filter((candidate) => candidate.id !== meldId)
      };
    });
  }

  function runSolver() {
    trackEvent("solve_deepblue_turn", {
      board_groups: state.board.length,
      hand_tiles: state.hand.length,
      initial_meld_complete: state.isInitialMeldComplete
    });

    try {
      const result = solveTurn(state);
      setSolverResult(result);
      trackEvent("solve_deepblue_result", {
        result: result.kind,
        hand_tiles: state.hand.length
      });
    } catch (error) {
      captureException(error);
      setSolverResult({
        kind: "draw",
        reason: "DeepBlue hit an unexpected solver error. The details were sent to Sentry if it is configured."
      });
    }
  }

  function applySolverMove() {
    if (!solverResult || solverResult.kind !== "play") {
      return;
    }
    updateState((current) => ({
      ...current,
      board: solverResult.board,
      hand: current.hand.filter((tile) => !solverResult.playedTiles.some((played) => played.id === tile.id)),
      isInitialMeldComplete: true
    }));
  }

  function reset() {
    clearState();
    setSolverResult(null);
    setSelectedTileId(null);
    setState(emptyState());
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div className="brand-copy">
            <div className="eyebrow">Weekend table mode</div>
            <h1>Rummikub Deep Blue</h1>
            <p>Track the board, keep DeepBlue&apos;s rack honest, then see what the machine would play.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <label>
            Pool
            <input
              min={0}
              max={106}
              type="number"
              value={state.poolRemaining}
              onChange={(event) => updateState((current) => ({ ...current, poolRemaining: Number(event.target.value) }))}
            />
          </label>
          <label className="checkbox">
            <input
              checked={state.isInitialMeldComplete}
              type="checkbox"
              onChange={(event) => updateState((current) => ({ ...current, isInitialMeldComplete: event.target.checked }))}
            />
            Initial meld complete
          </label>
          <button className="secondary" type="button" onClick={reset}>
            Reset
          </button>
        </div>
      </header>

      <div className="workspace">
        <TilePicker
          dragTarget={dragTarget}
          usedIds={usedIds}
          onAdd={addTileToHand}
          onDragEnd={endTileDrag}
          onDragLeave={() => leaveTileDrop("add-tiles")}
          onDragOver={(event) => allowTileDrop(event, "add-tiles")}
          onDragStart={startTileDrag}
          onDrop={dropTileOnPicker}
        />

        <section className="panel hand hand-panel">
          <div className="panel-header">
            <div className="panel-title">DeepBlue Hand</div>
            <span className="pill">{state.hand.length} tiles</span>
          </div>
          <div
            className={`tile-row drop-zone ${dragTarget === "hand" ? "drop-active" : ""}`}
            onDragLeave={() => leaveTileDrop("hand")}
            onDragOver={(event) => allowTileDrop(event, "hand")}
            onDrop={dropTileOnHand}
          >
            {state.hand.map((tile) => (
              <TileButton
                draggable
                dragging={draggingTileId === tile.id}
                key={tile.id}
                tile={tile}
                selected={selectedTileId === tile.id}
                onClick={() => setSelectedTileId(tile.id)}
                onDragEnd={endTileDrag}
                onDragStart={(event) => startTileDrag(event, tile.id)}
              />
            ))}
            {state.hand.length === 0 && <div className="empty">No hand tiles recorded.</div>}
          </div>
          <div className="button-row">
            <button disabled={!selectedTile} type="button" onClick={moveSelectedToHand}>
              Move selected to hand
            </button>
            <button disabled={!selectedTile} type="button" onClick={() => selectedTile && removeTile(selectedTile.id)}>
              Remove selected
            </button>
          </div>
        </section>

        <section className="panel board board-panel">
          <div className="panel-header">
            <div className="panel-title">Board</div>
            <button type="button" onClick={addMeld}>
              Add group
            </button>
          </div>
          <div className="meld-list">
            {state.board.map((meld, index) => (
              <div className="meld" key={meld.id}>
                <div className="meld-header">
                  <strong>Group {index + 1}</strong>
                  <button
                    aria-label={`Put selected tile in group ${index + 1}`}
                    className="icon-button place"
                    disabled={!selectedTile}
                    title="Put selected tile here"
                    type="button"
                    onClick={() => selectedTile && moveTileToMeld(selectedTile.id, meld.id)}
                  >
                    <PlaceIcon />
                  </button>
                  <button
                    aria-label={`Remove group ${index + 1}`}
                    className="icon-button"
                    title="Remove group"
                    type="button"
                    onClick={() => removeMeld(meld.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div
                  className={`tile-row drop-zone ${dragTarget === meld.id ? "drop-active" : ""}`}
                  onDragLeave={() => leaveTileDrop(meld.id)}
                  onDragOver={(event) => allowTileDrop(event, meld.id)}
                  onDrop={(event) => dropTileOnMeld(event, meld.id)}
                >
                  {meld.tiles.map((tile) => (
                    <TileButton
                      draggable
                      dragging={draggingTileId === tile.id}
                      key={tile.id}
                      tile={tile}
                      selected={selectedTileId === tile.id}
                      onClick={() => setSelectedTileId(tile.id)}
                      onDragEnd={endTileDrag}
                      onDragStart={(event) => startTileDrag(event, tile.id)}
                    />
                  ))}
                  {meld.tiles.length === 0 && <div className="empty">Empty group.</div>}
                </div>
              </div>
            ))}
          </div>
          {boardErrors.length > 0 && (
            <div className="errors">
              {boardErrors.map((error) => (
                <div key={error}>{error}</div>
              ))}
            </div>
          )}
        </section>

        <section className="panel solver solver-panel">
          <div className="panel-header">
            <div className="panel-title">DeepBlue Brain</div>
            <span className="pill">for fun</span>
          </div>
          <button className="primary" type="button" onClick={runSolver}>
            Solve DeepBlue turn
          </button>
          <p className="solver-note">
            Solver inspired by Rijn, Takes, and Vis,{" "}
            <a href="https://arxiv.org/abs/1604.07553" rel="noreferrer" target="_blank">
              The Complexity of Rummikub Problems
            </a>
            .
          </p>
          {solverResult?.kind === "draw" && <div className="result draw">Draw: {solverResult.reason}</div>}
          {solverResult?.kind === "play" && (
            <div className="result play">
              <div>
                <strong>Play {solverResult.playedTiles.length} tile(s), net score {solverResult.score}.</strong>
                <p>{solverResult.note}</p>
              </div>
              <div className="tile-row">
                {solverResult.playedTiles.map((tile) => (
                  <TileButton key={tile.id} tile={tile} onClick={() => setSelectedTileId(tile.id)} />
                ))}
              </div>
              <div className="target-board">
                {solverResult.board.map((meld, index) => (
                  <div className="target-meld" key={meld.id}>
                    <strong>{meld.type} {index + 1}</strong>
                    <div className="tile-row">
                      {meld.tiles.map((tile) => (
                        <TileButton key={tile.id} tile={tile} onClick={() => setSelectedTileId(tile.id)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button className="primary" type="button" onClick={applySolverMove}>
                Apply solver board
              </button>
            </div>
          )}
          <p className="timestamp">Saved {new Date(state.updatedAt).toLocaleString()}</p>
        </section>
      </div>

      <footer className="footer">
        <div className="footer-rack" aria-hidden="true">
          <span>D</span>
          <span>I</span>
          <span>O</span>
          <span>G</span>
          <span>O</span>
        </div>
        <p>
          Made with suspiciously legal tile rearrangements by{" "}
          <a href="https://github.com/dmelo" rel="noreferrer" target="_blank">
            Diogo Oliveira de Melo
          </a>
        </p>
      </footer>
    </main>
  );
}
