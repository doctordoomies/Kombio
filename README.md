# KOMBIO — Browser Edition 🃏

A standalone browser card game inspired by KOMBIO, playable against a computer opponent.

## Run locally

Open `index.html` in any modern browser. No install, build tool, or server required.

## Play online

Enable GitHub Pages in **Settings → Pages** with **Deploy from a branch**, `main`, `/ (root)`.

Then visit https://doctordoomies.github.io/Kombio/ after deployment.

## Features

- Four face-down cards per player; initial memory peek
- Card drawing, discarding, replacing, and matching
- Special cards for peek/swap actions
- KOMBIO call and round scoring
- Single-player computer opponent

## Current limitations

The single-player interface uses a turn-based matching window rather than true simultaneous, real-time matching. The CPU does not yet challenge matches, and special-card behavior and scoring still need dedicated tests against the official rules. This is not a finished or fully verified rules implementation.

## Roadmap

1. Check game rules and add tests
2. Add online multiplayer and private rooms
3. Polish visuals, sound, and accessibility

**Status:** Early, unofficial prototype. Full gameplay testing and official rule-by-rule verification are still needed. Not affiliated with the physical game's publisher.
