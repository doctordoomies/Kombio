# Architecture

```text
src/
├── engine/          Pure game rules. No DOM, no timers, no Math.random.
│   ├── cards.ts     Card type, ability mapping (7–14)
│   ├── rng.ts       Seeded mulberry32 PRNG (state stored as plain data)
│   ├── deck.ts      Deck construction and Fisher–Yates shuffle with injected RNG
│   ├── rules.ts     RulesConfig: rulebook values plus the unverified options, with defaults
│   ├── scoring.ts   Hand and round scoring, including optional add-ons
│   ├── actions.ts   The Action union: every possible state transition
│   ├── game.ts      GameState, createGame, applyAction (validation + reducer), events
│   ├── view.ts      getPlayerView: the redacted, per-player view of the state
│   └── index.ts     Public exports
├── ai/opponent.ts   Computer opponents (Easy/Normal/Hard profiles); input is a PlayerView only
├── ui/
│   ├── controller.ts GameController: owns the GameState, dispatches actions, schedules the CPUs
│   ├── settings.ts  Game settings (players, difficulty, length), validation, persistence
│   ├── setup.ts     Setup screen form binding and live settings summary
│   ├── board.ts     Renders the table from the human's PlayerView, maps clicks to Actions
│   ├── targeting.ts Which cards are sensible click targets right now (pure, unit-tested)
│   ├── summary.ts   Scoreboard and end-of-round summary
│   ├── cards.ts     Renders one card slot
│   └── log.ts       Formats public engine events for the game log
├── main.ts          Entry point: setup screen ↔ game screen, keyboard shortcuts
└── style.css        Desktop table layout (palette carried over from the prototype)
scripts/
└── e2e-firefox.mjs  Real-browser end-to-end test (headless Firefox, WebDriver BiDi, no dependencies)
tests/               Vitest suites (engine, AI, UI logic, jsdom UI integration)
docs/                This file and RULES.md
```

## Data flow

```text
           Action                               PlayerView (redacted)
  UI / AI ───────▶ applyAction(state, action) ──▶ getPlayerView(state, p) ──▶ UI / AI
                         │
                         ├─ ok:   new GameState + public GameEvents
                         └─ fail: the original state, untouched, plus an error message
```

### State

`GameState` is plain, JSON-serializable data. It holds the rules, player names, cumulative scores, round history, the current `RoundState`, the PRNG state, and the game-over flag. Because the PRNG state lives inside it, the whole game is deterministic given a seed and a sequence of actions. That makes replays, tests and a future server-authoritative mode straightforward.

`RoundState` holds:

- `hands[player][slot]`: `Card | null`. Slots are stable, so a matched-away card leaves a hole. That keeps positions meaningful for memory, and the hole is where a card given after an opponent match goes.
- `deck` and `discard` (the last element is the top card).
- `known[player]`: IDs of the cards that player has legitimately seen. Knowledge is tied to the card, not the position, so it follows the card through swaps (everyone sees which positions moved). It is cleared when cards are reshuffled into the deck.
- `step`: the turn player's sub-state: `start` → `holding` (drawn card) → `ability` (`choose` → `decide` for 13/14).
- `interrupt`: an out-of-turn decision that blocks everything else. Either `give` (after matching an opponent's card) or `mismatch` (the opponent chooses the wrong-match consequence).
- `attempts` / `attemptTop`: one match attempt per player per top-discard card.
- `caller` and `finalQueue`: KOMBIO and the final turns.

### Transitions

`applyAction` deep-copies the state (`structuredClone`) and runs the reducer on the copy. Each action is validated: right phase, right player, right step, target slot occupied, hand not locked, and so on. Any violation throws `IllegalActionError`, which is turned into `{ ok: false, state: <original> }`. A rejected action can't leave a partly applied state behind. The tests check this by comparing serialized state before and after every rejected action.

Every action carries the acting `player`. Locally, the UI and AI pass their own index. A future server would set `player` from the authenticated connection, never from the client payload.

### Hidden information

`getPlayerView(state, viewer)` is the only state interface the UI and AI use. It contains:

- each slot's `occupied` flag, and its `value` only if the viewer knows that card (or the round has ended)
- deck and discard counts, and the top discard value
- the held card's value only for its holder, or when it came from the face-up discard pile
- which slots are being looked at (public), but not their values
- the public rules config, scores, history, and the legal-move flags for the viewer

It never contains card IDs (they are assigned in value order and would leak values), deck order, other players' knowledge sets, or the PRNG state. Events returned by `applyAction` are public too: peeks list target positions, never values. Tests assert that views differing only in hidden cards are deep-equal, and that the serialized view contains no `id`, `known` or `rngState` keys.

### Computer opponents

`decideAction(view, profile, seed)` and `decideMatch(view, profile, seed)` in `src/ai/opponent.ts` take only a `PlayerView`, so by construction no difficulty level can see hidden cards or the deck. Their decisions are ordinary `Action`s, validated by the engine like a human's.

Difficulty is a `Profile`: the same decision code with different parameters.

| | Easy | Normal | Hard |
| --- | --- | --- | --- |
| Memory | Forgets each remembered card 15% of the time | Perfect | Perfect |
| Estimate for unknown cards | Deck average (≈6.3) | Deck average | Average of the cards it hasn't seen |
| Mistakes | 6% careless exchange or skipped ability; misses 30% of matches; 1% wrong-match guesses | None | None |
| Matches opponents' cards | No | Yes | Yes |
| Targets | First available | First available | The opponent with the lowest estimated hand |
| Calls KOMBIO | Estimate ≤ 8 | Estimate ≤ 7 | Estimate ≤ 2 (patient) |
| Match reaction (UI) | 2.6 s | 1.3 s | 0.8 s |

Randomness (Easy's mistakes) comes from a seeded PRNG keyed by the visible game situation. Asking again in the same situation gives the same answer, which matters because the controller re-asks after every state change, and tests can check it.

The profiles were tuned by simulation, playing complete 5-round games CPU against CPU:

- **2 players, 500 games:** Hard averaged 48.6 points to Normal's 65.7 and won 325 of the 496 games that had a winner.
- **2 players, 300 games:** Easy averaged 85.3 to Normal's 51.1 and won 58 of 299.
- **4 players, 200 games:** one Hard player against three Normals won 92 games, where an equal player would win about 50.

`tests/ai-difficulty.test.ts` checks the ordering Hard < Normal < Easy (average score) deterministically over 120 games.

### Browser controller

`GameController` (`src/ui/controller.ts`) keeps the authoritative `GameState` in memory. The UI renders only the human's `PlayerView`. After every change each CPU looks at its own view and, if it wants to act, starts a timer: its turn delay, or its match reaction time. When the timer fires it decides again from a fresh view, because the table may have changed. A pending match timer is kept while the discard pile is unchanged, so one CPU's actions don't keep resetting another CPU's reaction time, and a quick human can still win the race. The controller also records:

- **flashes:** cards briefly shown face up to the human, after their own peek or a public wrong match
- **highlights:** cards that just changed, so CPU actions are easy to follow

### Testing layers

- **Engine and AI unit tests:** rigged card layouts, invalid actions, visibility, AI knowledge restrictions, and complete CPU-only games with 2, 3 and 4 players that check card conservation after every action.
- **UI logic tests:** targeting rules, settings validation, seat layout.
- **jsdom integration tests:** load the real `index.html` and `main.ts`, then click through setup, abilities, matching and complete 2/3/4-player games with fake timers.
- **Real browser** (`npm run test:e2e`): plays games in headless Firefox against the production build. It checks computed layout, page errors and hidden-card leaks, and saves screenshots.

## Toward multiplayer

The engine is already shaped for a server-authoritative model:

1. Move `GameState` and `applyAction` to a server (Node runs the same TypeScript).
2. Clients send `Action`s; the server overwrites `action.player` with the authenticated seat.
3. After each accepted action, the server sends each client `getPlayerView(state, seat)` plus the public events.
4. Real-time matching becomes "first valid `match` the server receives wins". The engine already accepts matches out of turn, enforces one attempt per discard, and serializes everything through `applyAction`.
