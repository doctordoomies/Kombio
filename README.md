# KOMBIO — Browser Edition 🃏

An unofficial browser implementation of the KOMBIO card game. You play against one to three computer opponents. Not affiliated with the game's publisher.

## Requirements

- Node.js 20.19+ or 22.12+ (developed on Node 24, Fedora Asahi Remix, ARM64)
- npm

There are no runtime dependencies. Dev dependencies are Vite, TypeScript, Vitest and jsdom, all of which work on ARM64 Linux. The optional end-to-end test uses the Firefox already installed on your system.

## Getting started

```bash
git clone https://github.com/doctordoomies/Kombio.git
cd Kombio
npm install
npm run dev          # http://localhost:5173
```

> Opening `index.html` directly no longer works: the game is now TypeScript and has to be served by Vite (`npm run dev`) or built (`npm run build`).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm test` | Runs the whole test suite once (Vitest) |
| `npm run test:watch` | Runs the tests in watch mode |
| `npm run typecheck` | TypeScript type checking |
| `npm run build` | Type-checks, then builds a production bundle into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run test:e2e` | Plays 2-, 3- and 4-player games in headless Firefox against the production build (run `npm run build` first). Screenshots go to `e2e-artifacts/`. Set `FIREFOX=/path/to/firefox` if Firefox isn't on your PATH. |

## Deploying to GitHub Pages

The build uses relative asset paths (`base: './'`), so `dist/` works at `https://doctordoomies.github.io/Kombio/`.

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The old "Deploy from a branch / root" setting would serve the unbuilt source and no longer works.
2. Push to `main`. `.github/workflows/deploy.yml` installs dependencies, runs the tests, builds, and deploys `dist/`. The workflow can also be started manually with **Run workflow**, and on pull requests it runs tests and the build without deploying.

## Current features

- **Game setup:** 2–4 players (you plus 1–3 CPUs), CPU difficulty, and game length (unlimited, a fixed number of rounds, or a score limit). Every setting is shown before you start, and your last choices are remembered.
- **Desktop card table:** opponents sit clockwise around the table. A turn banner and a glowing seat show whose turn it is, and badges mark the dealer, the KOMBIO caller and locked hands. The draw pile, discard pile and drawn card sit in the centre.
- **Targeting:** cards you can click are outlined and the rest are dimmed. Two-card abilities show your first pick. Clicking an invalid card explains why instead of doing nothing.
- **Scoreboard and round summary:** cumulative scores with a per-round breakdown. At the end of each round a summary shows every revealed hand, the hand score, the +10/+15 adjustment and the new total, followed by final results.
- **Activity highlights:** cards a CPU looked at, swapped, matched or exchanged pulse briefly, and the game log lists every public action.
- **Keyboard shortcuts:** <kbd>D</kbd> draw, <kbd>T</kbd> take the discard, <kbd>M</kbd> match mode, <kbd>S</kbd> skip an ability, <kbd>Esc</kbd> cancel.
- **CPU difficulty:**
  - **Easy** forgets cards, makes careless exchanges, misses matches and occasionally guesses a match wrongly.
  - **Normal** remembers everything it has seen and plays sensibly.
  - **Hard** estimates unseen cards, aims abilities at the leader, matches quickly and calls KOMBIO patiently.
  - Every level decides from its own player view only, so none of them can see hidden cards.
- **Rules engine** (from milestone 1):
  - drawing, taking the discard, exchanging
  - all 7–14 abilities
  - matching at any time, with penalties and the opponent's choice after a wrong match on their card
  - KOMBIO and automatic KOMBIO, final turns, caller lock for 3+ players
  - scoring, multiple rounds, deck reshuffling
  - stable card IDs and seeded shuffling

## Rules fidelity

Implemented rules follow the publisher's two-page rule sheet. The official page https://kombio.cards/pages/rules couldn't be fetched during development (HTTP 429), so it still needs checking. Every rule that isn't in the rule sheet, such as per-value card counts and deck exhaustion, is listed in [docs/RULES.md](docs/RULES.md) and is configurable in `src/engine/rules.ts`. Changes from the original prototype are listed there as well.

## Known limitations

- Desktop first. Narrow windows stack the table so it stays usable, but there's no dedicated mobile interface yet.
- Single player only: no online multiplayer yet. The engine supports up to 6 players; the UI offers 2–4.
- All CPUs in a game share one difficulty level.
- Real-time matching is approximated with per-difficulty CPU reaction times (Hard ≈ 0.8 s, Normal ≈ 1.3 s, Easy ≈ 2.6 s), so a quick human can beat a CPU to a match.
- CPUs remember perfectly what they've seen (Easy forgets on purpose). Difficulty strength was tuned by simulation, not by human playtesting.
- Per-value deck counts and the deck-exhaustion rule are unverified (see docs/RULES.md).
- No sound or card-movement animations. Keyboard shortcuts cover the main actions, but choosing a card still needs a click.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the engine, views, AI and UI fit together
- [docs/RULES.md](docs/RULES.md): rule sources, verification status, interpretations

## Roadmap

1. Verify the remaining rules against the official site and a physical deck
2. Mobile layout and touch interactions
3. Online multiplayer with private rooms (server-authoritative, built on the existing engine)
4. Animations, sound and fuller keyboard/screen-reader support
