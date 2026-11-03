# KOMBIO — Browser Edition 🃏

An unofficial browser implementation of the KOMBIO card game. You play against a computer opponent. Not affiliated with the game's publisher.

## Requirements

- Node.js 20.19+ or 22.12+ (developed on Node 24, Fedora Asahi Remix, ARM64)
- npm

There are no runtime dependencies. Dev dependencies are Vite, TypeScript, Vitest and jsdom, all of which work on ARM64 Linux.

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

## Deploying to GitHub Pages

The build uses relative asset paths (`base: './'`), so `dist/` works at `https://doctordoomies.github.io/Kombio/`.

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The old "Deploy from a branch / root" setting would serve the unbuilt source and no longer works.
2. Push to `main`. `.github/workflows/deploy.yml` installs dependencies, runs the tests, builds, and deploys `dist/`. The workflow can also be started manually with **Run workflow**, and on pull requests it runs tests and the build without deploying.

## Current features

- Rules engine separated from the UI, with validated actions, stable card IDs, and seeded, deterministic shuffling
- Setup: four cards in a 2×2 grid, peek at the bottom two, empty discard pile at the start
- Draw from the deck or take the top discard, then exchange a card. A card drawn from the deck can be discarded to use its ability.
- All abilities: 7–8 look at your own card, 9–10 look at an opponent's, 11–12 blind swap, 13 look & swap, 14 double look & swap. All optional.
- Matching at any time, including out of turn, against your own or the opponent's cards:
  - one attempt per discard
  - penalty card for a wrong match on your own card
  - the opponent decides the consequence of a wrong match on their card
  - optionally give a card after matching an opponent's card
- KOMBIO calls (and automatic KOMBIO on an empty hand), final turns, caller lock for 3+ players
- Scoring: +10 to everyone else when the caller is strictly lowest, +15 to the caller otherwise. Optional 14 add-ons.
- Multiple rounds with cumulative scores. Optional round limit or score limit.
- Deck exhaustion: the discard pile is reshuffled into a new deck
- Computer opponent that uses only information it is allowed to know
- Layout works on desktop and mobile

## Rules fidelity

Implemented rules follow the publisher's two-page rule sheet. The official page https://kombio.cards/pages/rules couldn't be fetched during development (HTTP 429), so it still needs checking. Every rule that isn't in the rule sheet, such as per-value card counts and deck exhaustion, is listed in [docs/RULES.md](docs/RULES.md) and is configurable in `src/engine/rules.ts`. Changes from the original prototype are listed there as well.

## Known limitations

- Single player only (you vs. one CPU). The engine supports 2–6 players, but the UI is built for two.
- Real-time matching is approximated. The CPU waits about 1.3 s before matching, so you can beat it. True simultaneous matching needs the future server.
- Per-value deck counts and the deck-exhaustion rule are unverified (see docs/RULES.md).
- The CPU strategy is deliberately simple, and it has perfect memory of what it has seen.
- No game-length setting in the UI yet. Rounds continue until you start a new game, though the engine supports a round or score limit.
- No sound and no animations. Accessibility is basic (buttons and ARIA labels, no full keyboard flow).
- Your seen cards are outlined but not labelled, by design: remembering them is part of the game.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the engine, views, AI and UI fit together
- [docs/RULES.md](docs/RULES.md): rule sources, verification status, interpretations

## Roadmap

1. Verify the remaining rules against the official site and a physical deck
2. Online multiplayer with private rooms (server-authoritative, built on the existing engine)
3. Visual polish, sound and accessibility
