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
├── ai/opponent.ts   Computer opponent; input is a PlayerView only
├── ui/
│   ├── cards.ts     Renders one card slot
│   └── board.ts     Renders a PlayerView, maps clicks to Actions, formats the log
├── main.ts          Browser controller: holds the state, dispatches actions, schedules the CPU
└── style.css        Visuals carried over from the prototype
tests/               Vitest suites (engine, AI, jsdom UI integration)
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

### Computer opponent

`decideAction(view)` and `decideMatch(view)` in `src/ai/opponent.ts` take only a `PlayerView`, so by construction they can't see hidden cards or the deck. The strategy:

- treat unknown cards as worth the deck average (about 6.3)
- call KOMBIO when the estimated total is at most 7, at most one card is unknown, and every opponent's estimate is higher
- take the discard when it beats its worst known card by 2 or more, or when it is 2 or lower and it has unknown cards
- exchange a drawn card for its highest known card if lower, otherwise put it on an unknown slot if it is 4 or lower, otherwise discard it for its ability
- use abilities purposefully: look at its own or opponents' unknown cards, and swap its high known cards for opponents' low or unknown cards
- match only cards whose value it knows, preferring its own
- after a wrong match on its card, make the matcher take the card if it is positive; give away its highest-estimated card after matching an opponent's

A stronger opponent can implement the same two functions.

### Browser controller

`main.ts` keeps the authoritative `GameState` in memory, renders the human's `PlayerView`, and turns clicks into `Action`s. After every change it asks the AI, using the AI's own view, whether it wants to act. Turn actions run after about 0.75 s. Matches run after about 1.3 s and are re-checked before they fire, so the human can win a matching race.

## Toward multiplayer

The engine is already shaped for a server-authoritative model:

1. Move `GameState` and `applyAction` to a server (Node runs the same TypeScript).
2. Clients send `Action`s; the server overwrites `action.player` with the authenticated seat.
3. After each accepted action, the server sends each client `getPlayerView(state, seat)` plus the public events.
4. Real-time matching becomes "first valid `match` the server receives wins". The engine already accepts matches out of turn, enforces one attempt per discard, and serializes everything through `applyAction`.
