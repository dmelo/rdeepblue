// Polynomial dynamic-programming solver for the Rummikub puzzle, after
// van Rijn, Takes & Vis, "The Complexity of Rummikub Problems" (Algorithm 1,
// MAXSCORE). We process tile values 1..13 left to right; the state is, per
// suit, the two open runs and a count of jokers that have landed in completed
// melds. Groups are formed from the tiles left over at each value. Unlike the
// paper, jokers score their represented value (so score == meldValue), which
// keeps run scoring independent of which positions are jokers.
//
// Each open run carries three facts, encoded in its slot state:
//   - length, bucketed to {0, 1, 2, 3+}
//   - whether it currently holds a board tile (the table constraint: abandoning
//     such a run strands a board tile and is infeasible)
//   - how many jokers it currently holds (pending jokers). A joker only becomes
//     "used" when its run reaches length 3; if the run is abandoned the joker
//     returns to the pool. This is why we cannot simply count jokers at the
//     moment they are placed.
//
// This module exposes the pure scorer (dpMaxValue). Reconstruction of the actual
// melds lives in solver.ts, which replays the same transitions.
import { COLORS, type JokerAssignment, type Tile } from "./types";

const NSUIT = 4;
const NVAL = 13;

// Slot (open-run) states.
const EMPTY = 0;
const L1H = 1; // len 1, hand real
const L1B = 2; // len 1, board real (obligation)
const L1J = 3; // len 1, joker (pending)
const L2_00 = 4; // len 2, 0 jokers, no obligation
const L2_01 = 5; // len 2, 0 jokers, obligation
const L2_10 = 6; // len 2, 1 joker, no obligation
const L2_11 = 7; // len 2, 1 joker, obligation
const L2_20 = 8; // len 2, 2 jokers
const L3 = 9; // len >= 3 (valid; already scored, jokers already counted)
const NSTATE = 10;

// Pending jokers per slot state.
const PJ = [0, 0, 0, 1, 0, 0, 1, 1, 2, 0];
// Whether the slot holds a board tile (abandoning it strands a board tile).
const OBL = [false, false, true, false, false, true, false, true, false, false];

export type Counts = {
  avail: number[][]; // [suit][value] real tiles present (0..2)
  board: number[][]; // [suit][value] of those that are board tiles (must be used)
  totalJokers: number;
  boardJokers: number;
};

export function buildCounts(tiles: Tile[], requiredIds: Set<string>): Counts {
  const avail = Array.from({ length: NSUIT }, () => new Array<number>(NVAL + 1).fill(0));
  const board = Array.from({ length: NSUIT }, () => new Array<number>(NVAL + 1).fill(0));
  let totalJokers = 0;
  let boardJokers = 0;

  for (const tile of tiles) {
    if (tile.kind === "joker") {
      totalJokers += 1;
      if (requiredIds.has(tile.id)) boardJokers += 1;
    } else {
      const suit = COLORS.indexOf(tile.color);
      avail[suit][tile.value] += 1;
      if (requiredIds.has(tile.id)) board[suit][tile.value] += 1;
    }
  }

  return { avail, board, totalJokers, boardJokers };
}

// --- Per-suit run transitions -------------------------------------------------

const STOP = 0; // do not extend (closes/abandons the run)
const ER_HAND = 1; // extend with a hand real tile
const ER_BOARD = 2; // extend with a board real tile
const EJ = 3; // extend with a joker
const ACTIONS = [STOP, ER_HAND, ER_BOARD, EJ];

// New slot state after STOP, or -1 if a board tile would be stranded.
function slotStop(slot: number): number {
  return OBL[slot] ? -1 : EMPTY;
}

// New slot state, meldValue gained, and jokers that become "used" (added to the
// completed-joker count) when extending a slot at value v.
function slotExtend(slot: number, v: number, isJoker: boolean, isBoard: boolean): { next: number; score: number; jc: number } {
  const run = 3 * v - 3; // (v-2)+(v-1)+v, completion of a length-3 run
  if (isJoker) {
    switch (slot) {
      case EMPTY:
        return { next: L1J, score: 0, jc: 0 };
      case L1H:
        return { next: L2_10, score: 0, jc: 0 };
      case L1B:
        return { next: L2_11, score: 0, jc: 0 };
      case L1J:
        return { next: L2_20, score: 0, jc: 0 };
      case L2_00:
      case L2_01:
        return { next: L3, score: run, jc: 1 };
      case L2_10:
      case L2_11:
        return { next: L3, score: run, jc: 2 };
      case L2_20:
        return { next: L3, score: run, jc: 3 };
      case L3:
        return { next: L3, score: v, jc: 1 };
    }
  } else {
    switch (slot) {
      case EMPTY:
        return { next: isBoard ? L1B : L1H, score: 0, jc: 0 };
      case L1H:
        return { next: isBoard ? L2_01 : L2_00, score: 0, jc: 0 };
      case L1B:
        return { next: L2_01, score: 0, jc: 0 };
      case L1J:
        return { next: isBoard ? L2_11 : L2_10, score: 0, jc: 0 };
      case L2_00:
      case L2_01:
        return { next: L3, score: run, jc: 0 };
      case L2_10:
      case L2_11:
        return { next: L3, score: run, jc: 1 };
      case L2_20:
        return { next: L3, score: run, jc: 2 };
      case L3:
        return { next: L3, score: v, jc: 0 };
    }
  }
  return { next: slot, score: 0, jc: 0 };
}

export type SuitPlan = {
  nextCode: number; // canonical pair code of resulting slots
  next: number[]; // resulting slot states in [slot0, slot1] order (for replay)
  actions: number[]; // representative action per slot (for replay)
  score: number; // run meldValue gained at this value
  jc: number; // jokers that became used (completed) at this value
  pending: number; // pending jokers held in the resulting slots
  leftoverReals: number; // reals not consumed by runs (available to groups)
  leftoverBoard: number; // of which are board (must be grouped)
};

function pairCode(a: number, b: number): number {
  return a <= b ? a * NSTATE + b : b * NSTATE + a;
}

const planCache = new Map<number, SuitPlan[]>();

// Cached per-suit plan enumeration. Plans depend only on (slotA, slotB, r, bc, v).
export function suitPlans(slotA: number, slotB: number, r: number, bc: number, v: number): SuitPlan[] {
  const key = (((slotA * NSTATE + slotB) * 3 + r) * 3 + bc) * 16 + v;
  let cached = planCache.get(key);
  if (!cached) {
    cached = enumerateSuitPlans(slotA, slotB, r, bc, v);
    planCache.set(key, cached);
  }
  return cached;
}

export function enumerateSuitPlans(slotA: number, slotB: number, r: number, bc: number, v: number): SuitPlan[] {
  const plans = new Map<string, SuitPlan>();
  const slots = [slotA, slotB];

  for (const a1 of ACTIONS) {
    for (const a2 of ACTIONS) {
      const acts = [a1, a2];
      const nextStates: number[] = [];
      let realsUsed = 0;
      let boardUsed = 0;
      let score = 0;
      let jc = 0;
      let feasible = true;

      for (let i = 0; i < 2; i += 1) {
        const slot = slots[i];
        const act = acts[i];
        if (act === STOP) {
          const next = slotStop(slot);
          if (next < 0) {
            feasible = false;
            break;
          }
          nextStates.push(next);
          continue;
        }
        const isJoker = act === EJ;
        const isBoard = act === ER_BOARD;
        if (act === ER_HAND || act === ER_BOARD) realsUsed += 1;
        if (act === ER_BOARD) boardUsed += 1;
        const res = slotExtend(slot, v, isJoker, isBoard);
        nextStates.push(res.next);
        score += res.score;
        jc += res.jc;
      }

      if (!feasible) continue;
      if (realsUsed > r) continue;
      if (boardUsed > bc) continue;
      const leftoverReals = r - realsUsed;
      const leftoverBoard = bc - boardUsed;
      if (leftoverReals < leftoverBoard) continue; // not enough hand reals

      const nextCode = pairCode(nextStates[0], nextStates[1]);
      const pending = PJ[nextStates[0]] + PJ[nextStates[1]];
      const key = `${nextCode}|${score}|${jc}|${leftoverReals}|${leftoverBoard}`;
      if (!plans.has(key)) {
        plans.set(key, { nextCode, next: [nextStates[0], nextStates[1]], actions: [a1, a2], score, jc, pending, leftoverReals, leftoverBoard });
      }
    }
  }

  return [...plans.values()];
}

// --- Group formation (value-independent precompute) ---------------------------

function leftoverIdx(reals: number, board: number): number {
  if (reals === 0) return 0;
  if (reals === 1) return board === 0 ? 1 : 2;
  return board === 0 ? 3 : board === 1 ? 4 : 5;
}

const LEFTOVER_DECODE: Array<{ reals: number; board: number }> = [
  { reals: 0, board: 0 },
  { reals: 1, board: 0 },
  { reals: 1, board: 1 },
  { reals: 2, board: 0 },
  { reals: 2, board: 1 },
  { reals: 2, board: 2 }
];

function popcount(x: number): number {
  let count = 0;
  let n = x;
  while (n) {
    n &= n - 1;
    count += 1;
  }
  return count;
}

export type GroupOption = { jokers: number; total: number };

// groupFrontier[vectorCode] -> minimal-joker frontier of (jokers used, total
// group tiles). total*v is the meldValue contributed. Empty array => the leftover
// board tiles cannot all be placed in groups (infeasible).
const groupFrontier: GroupOption[][] = (() => {
  const table: GroupOption[][] = new Array(6 ** NSUIT);
  for (let code = 0; code < table.length; code += 1) {
    const r: number[] = [];
    const b: number[] = [];
    let rest = code;
    for (let c = 0; c < NSUIT; c += 1) {
      const dec = LEFTOVER_DECODE[rest % 6];
      r.push(dec.reals);
      b.push(dec.board);
      rest = Math.floor(rest / 6);
    }

    const best = [-1, -1, -1]; // best[j] = max total tiles using <= j jokers
    for (let g1 = 0; g1 < 16; g1 += 1) {
      const s1 = popcount(g1);
      if (s1 === 1 || s1 === 2) continue;
      for (let g2 = 0; g2 < 16; g2 += 1) {
        const s2 = popcount(g2);
        if (s2 === 1 || s2 === 2) continue;

        let jokers = 0;
        let feasible = true;
        for (let c = 0; c < NSUIT; c += 1) {
          const a = ((g1 >> c) & 1) + ((g2 >> c) & 1);
          if (a < b[c]) {
            feasible = false;
            break;
          }
          jokers += Math.max(0, a - r[c]);
        }
        if (!feasible || jokers > 2) continue;
        const total = s1 + s2;
        for (let j = jokers; j <= 2; j += 1) {
          if (total > best[j]) best[j] = total;
        }
      }
    }

    const frontier: GroupOption[] = [];
    let prev = -1;
    for (let j = 0; j <= 2; j += 1) {
      if (best[j] > prev) {
        frontier.push({ jokers: j, total: best[j] });
        prev = best[j];
      }
    }
    table[code] = frontier;
  }
  return table;
})();

// --- Core DP ------------------------------------------------------------------

const NEG = Number.NEGATIVE_INFINITY;

export class DpSolver {
  private memoNum = new Map<number, number>();

  constructor(private readonly counts: Counts) {}

  private baseCase(configs: number[], ju: number): number {
    for (const cfg of configs) {
      const a = Math.floor(cfg / NSTATE);
      const b = cfg % NSTATE;
      if (OBL[a] || OBL[b]) return NEG; // board tile stranded in an open run
    }
    return ju >= this.counts.boardJokers ? 0 : NEG;
  }

  dp(v: number, configs: number[], ju: number): number {
    if (v > NVAL) return this.baseCase(configs, ju);

    const configCode = configs[0] + 100 * (configs[1] + 100 * (configs[2] + 100 * configs[3]));
    const key = configCode * 42 + v * 3 + ju;
    const cached = this.memoNum.get(key);
    if (cached !== undefined) return cached;

    const plansPerSuit: SuitPlan[][] = configs.map((cfg, c) => {
      const a = Math.floor(cfg / NSTATE);
      const b = cfg % NSTATE;
      return suitPlans(a, b, this.counts.avail[c][v], this.counts.board[c][v], v);
    });

    let best = NEG;
    const nextConfig = [0, 0, 0, 0];
    const leftIdx = [0, 0, 0, 0];

    const totalJokers = this.counts.totalJokers;
    const go = (c: number, runScore: number, sumJc: number, sumPending: number) => {
      // Completed + pending jokers only grow; bail once they exceed the pool.
      if (ju + sumJc + sumPending > totalJokers) return;
      if (c === NSUIT) {
        const vecCode = leftIdx[0] + 6 * (leftIdx[1] + 6 * (leftIdx[2] + 6 * leftIdx[3]));
        for (const opt of groupFrontier[vecCode]) {
          const ju2 = ju + sumJc + opt.jokers;
          // Jokers currently in play (completed + still pending) cannot exceed the pool.
          if (ju2 + sumPending > this.counts.totalJokers) continue;
          const sub = this.dp(v + 1, [nextConfig[0], nextConfig[1], nextConfig[2], nextConfig[3]], ju2);
          if (sub === NEG) continue;
          const total = runScore + opt.total * v + sub;
          if (total > best) best = total;
        }
        return;
      }
      for (const p of plansPerSuit[c]) {
        nextConfig[c] = p.nextCode;
        leftIdx[c] = leftoverIdx(p.leftoverReals, p.leftoverBoard);
        go(c + 1, runScore + p.score, sumJc + p.jc, sumPending + p.pending);
      }
    };

    go(0, 0, 0, 0);
    this.memoNum.set(key, best);
    return best;
  }

  // Replays the optimal transitions to materialize the actual melds. Each open
  // run remembers its suit and start value so jokers are reported at the value
  // they represent and each meld's value sums exactly to the DP score.
  reconstruct(tiles: Tile[], requiredIds: Set<string>): { meldValue: number; melds: DpMeld[] } | null {
    const total = this.dp(1, [0, 0, 0, 0], 0);
    if (total === NEG) return null;
    const { totalJokers } = this.counts;

    type RunObj = { suit: number; start: number; tiles: Tile[] };

    const realPool: Array<Array<{ board: Tile[]; hand: Tile[] }>> = Array.from({ length: NSUIT }, () =>
      Array.from({ length: NVAL + 1 }, () => ({ board: [] as Tile[], hand: [] as Tile[] }))
    );
    const jokerBoard: Tile[] = [];
    const jokerHand: Tile[] = [];
    for (const tile of tiles) {
      if (tile.kind === "joker") {
        (requiredIds.has(tile.id) ? jokerBoard : jokerHand).push(tile);
      } else {
        const suit = COLORS.indexOf(tile.color);
        (requiredIds.has(tile.id) ? realPool[suit][tile.value].board : realPool[suit][tile.value].hand).push(tile);
      }
    }

    const concrete: Array<Array<RunObj | null>> = [
      [null, null],
      [null, null],
      [null, null],
      [null, null]
    ];
    const melds: DpMeld[] = [];
    let ju = 0;

    const stateOf = (run: RunObj | null): number => {
      if (!run) return EMPTY;
      const len = run.tiles.length;
      if (len >= 3) return L3;
      if (len === 1) {
        const t = run.tiles[0];
        return t.kind === "joker" ? L1J : requiredIds.has(t.id) ? L1B : L1H;
      }
      let jc = 0;
      let board = false;
      for (const t of run.tiles) {
        if (t.kind === "joker") jc += 1;
        else if (requiredIds.has(t.id)) board = true;
      }
      if (jc === 2) return L2_20;
      if (jc === 1) return board ? L2_11 : L2_10;
      return board ? L2_01 : L2_00;
    };

    const finalizeRun = (run: RunObj) => {
      const color = COLORS[run.suit];
      const assignments: JokerAssignment[] = [];
      let meldValue = 0;
      run.tiles.forEach((tile, index) => {
        const value = run.start + index;
        meldValue += value;
        if (tile.kind === "joker") assignments.push({ jokerId: tile.id, color, value });
      });
      melds.push({ type: "run", tiles: run.tiles, jokerAssignments: assignments, meldValue });
    };

    const finalizeGroup = (groupTiles: Tile[], v: number) => {
      const usedColors = new Set(groupTiles.filter((t) => t.kind === "regular").map((t) => (t.kind === "regular" ? t.color : "")));
      const missing = COLORS.filter((c) => !usedColors.has(c));
      const assignments: JokerAssignment[] = groupTiles
        .filter((t) => t.kind === "joker")
        .map((t, index) => ({ jokerId: t.id, color: missing[index], value: v }));
      melds.push({ type: "group", tiles: groupTiles, jokerAssignments: assignments, meldValue: groupTiles.length * v });
    };

    const validMasks: number[] = [];
    for (let m = 0; m < 16; m += 1) {
      const p = popcount(m);
      if (p === 0 || p >= 3) validMasks.push(m);
    }

    for (let v = 1; v <= NVAL; v += 1) {
      const configs = [0, 1, 2, 3].map((c) => pairCode(stateOf(concrete[c][0]), stateOf(concrete[c][1])));
      const target = this.dp(v, configs, ju);
      const plansPerSuit = [0, 1, 2, 3].map((c) =>
        suitPlans(stateOf(concrete[c][0]), stateOf(concrete[c][1]), this.counts.avail[c][v], this.counts.board[c][v], v)
      );

      let chosen: { plans: SuitPlan[]; g1: number; g2: number; ju2: number } | null = null;
      const pick: SuitPlan[] = new Array(NSUIT);

      const search = (c: number, runScore: number, sumJc: number, sumPending: number): boolean => {
        if (c === NSUIT) {
          const nextConfigs = [pick[0].nextCode, pick[1].nextCode, pick[2].nextCode, pick[3].nextCode];
          for (const g1 of validMasks) {
            for (const g2 of validMasks) {
              let groupJokers = 0;
              let groupTiles = 0;
              let feasible = true;
              for (let s = 0; s < NSUIT; s += 1) {
                const a = ((g1 >> s) & 1) + ((g2 >> s) & 1);
                if (a < pick[s].leftoverBoard) {
                  feasible = false;
                  break;
                }
                const realFills = Math.min(a, pick[s].leftoverReals);
                groupJokers += a - realFills;
                groupTiles += a;
              }
              if (!feasible || groupJokers > 2) continue;
              const ju2 = ju + sumJc + groupJokers;
              if (ju2 + sumPending > totalJokers) continue;
              const sub = this.dp(v + 1, nextConfigs, ju2);
              if (sub === NEG) continue;
              if (runScore + groupTiles * v + sub === target) {
                chosen = { plans: [pick[0], pick[1], pick[2], pick[3]], g1, g2, ju2 };
                return true;
              }
            }
          }
          return false;
        }
        for (const p of plansPerSuit[c]) {
          pick[c] = p;
          if (search(c + 1, runScore + p.score, sumJc + p.jc, sumPending + p.pending)) return true;
        }
        return false;
      };

      if (!search(0, 0, 0, 0) || !chosen) {
        throw new Error(`DP reconstruction failed at value ${v}`);
      }
      const choice: { plans: SuitPlan[]; g1: number; g2: number; ju2: number } = chosen;

      // Apply run actions.
      for (let s = 0; s < NSUIT; s += 1) {
        const plan = choice.plans[s];
        for (let i = 0; i < 2; i += 1) {
          const act = plan.actions[i];
          const run = concrete[s][i];
          if (act === STOP) {
            if (run && run.tiles.length >= 3) finalizeRun(run);
            else if (run) {
              for (const t of run.tiles) if (t.kind === "joker") (requiredIds.has(t.id) ? jokerBoard : jokerHand).push(t);
            }
            concrete[s][i] = null;
            continue;
          }
          let tile: Tile | undefined;
          if (act === ER_BOARD) tile = realPool[s][v].board.pop();
          else if (act === ER_HAND) tile = realPool[s][v].hand.pop();
          else tile = jokerBoard.pop() ?? jokerHand.pop();
          if (!tile) throw new Error(`DP reconstruction missing tile (suit ${s}, value ${v}, action ${act})`);
          if (run) run.tiles.push(tile);
          else concrete[s][i] = { suit: s, start: v, tiles: [tile] };
        }
      }

      // Apply group actions.
      const fills = [0, 1, 2, 3].map((s) => {
        const a = ((choice.g1 >> s) & 1) + ((choice.g2 >> s) & 1);
        const realFills = Math.min(a, choice.plans[s].leftoverReals);
        return { board: choice.plans[s].leftoverBoard, hand: realFills - choice.plans[s].leftoverBoard, jokers: a - realFills };
      });
      for (const g of [choice.g1, choice.g2]) {
        if (g === 0) continue;
        const groupTiles: Tile[] = [];
        for (let s = 0; s < NSUIT; s += 1) {
          if (((g >> s) & 1) === 0) continue;
          let tile: Tile | undefined;
          if (fills[s].board > 0) {
            tile = realPool[s][v].board.pop();
            fills[s].board -= 1;
          } else if (fills[s].hand > 0) {
            tile = realPool[s][v].hand.pop();
            fills[s].hand -= 1;
          } else {
            tile = jokerBoard.pop() ?? jokerHand.pop();
            fills[s].jokers -= 1;
          }
          if (!tile) throw new Error(`DP reconstruction missing group tile (suit ${s}, value ${v})`);
          groupTiles.push(tile);
        }
        finalizeGroup(groupTiles, v);
      }

      ju = choice.ju2;
    }

    for (let s = 0; s < NSUIT; s += 1) {
      for (let i = 0; i < 2; i += 1) {
        const run = concrete[s][i];
        if (run && run.tiles.length >= 3) finalizeRun(run);
      }
    }

    return { meldValue: total, melds };
  }
}

export type DpMeld = {
  type: "run" | "group";
  tiles: Tile[];
  jokerAssignments: JokerAssignment[];
  meldValue: number;
};

// Full solve: maximum-value arrangement (meldValue) using every tile in
// requiredIds and reaching minMeldValue, with the concrete melds. Null if none.
export function dpSolve(tiles: Tile[], requiredIds: Set<string>, minMeldValue: number): { meldValue: number; melds: DpMeld[] } | null {
  const counts = buildCounts(tiles, requiredIds);
  const solver = new DpSolver(counts);
  const result = solver.reconstruct(tiles, requiredIds);
  if (!result) return null;
  return result.meldValue >= minMeldValue ? result : null;
}

// Maximum total meldValue achievable from `tiles` while using every tile in
// `requiredIds` and reaching at least `minMeldValue`. Null if impossible.
export function dpMaxValue(tiles: Tile[], requiredIds: Set<string>, minMeldValue: number): number | null {
  const counts = buildCounts(tiles, requiredIds);
  const solver = new DpSolver(counts);
  const best = solver.dp(1, [0, 0, 0, 0], 0);
  if (best === NEG) return null;
  return best >= minMeldValue ? best : null;
}

export function dpCanUseAllTiles(tiles: Tile[]): boolean {
  const required = new Set(tiles.map((tile) => tile.id));
  return dpMaxValue(tiles, required, 0) !== null;
}
