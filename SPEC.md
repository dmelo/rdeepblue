# Rummikub Deep Blue

Deep Blue was the chess supercomputer that beat Kasparov. Rummikub Deep Blue plays Rummikub against a human opponent on a physical board.

## Roles

A human operator sits between the physical board and the UI. They translate the opponent's moves into the UI, then execute DeepBlue's moves on the physical board.

## Turn flow

**Opponent's turn**: the operator updates the UI with the diff since the last state — tiles added to the board, tiles moved between groups, and any tiles drawn into DeepBlue's hand. The board persists across turns; the UI edits it rather than re-entering it.

**DeepBlue's turn**: the solver runs and outputs either:
- a set of tiles to move from DeepBlue's hand onto the board, with their target groups, or
- a draw instruction if no play is preferable.

The operator then executes the move on the physical board.

## Rules

Standard Rummikub: 4 colors × 1–13, 2 jokers, 30-point initial meld, standard joker replacement. The solver enforces all rule constraints.

## Solver

Implements the polynomial-time algorithm from Rijn et al. (see @docs/1604.07553v1.pdf). The solver decides between playing and drawing each turn.

## Persistence

Every state change is written to `localStorage`. Reopening the URL restores the latest snapshot.

## Tech stack

TypeScript + React, client-only. Deployed as static assets to AWS S3, served via CloudFront.

## Testing

Unit tests cover the solver: rule validation, set/run detection, joker handling, and the initial-meld constraint.
