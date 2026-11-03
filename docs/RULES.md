# Rules: sources and verification status

## Sources

| Source | Status |
| --- | --- |
| https://kombio.cards/pages/rules (official site named in the task) | **Not read.** Every fetch returned HTTP 429 (rate limited) on 2026-11-02. Re-check against it when it's reachable. |
| Publisher's two-page rule sheet, "KOMBIO RULES — kombiocards.com" ([Tabletopia copy](https://c.tabletopia.com/games/kombio/rules/kombio-rules-english/en)) | **Read in full.** This is the source for every rule marked *Rulebook* below. |
| [rulespal.com/kombio/rulebook](https://rulespal.com/kombio/rulebook) | Third-party transcription. It matches the rule sheet and adds nothing beyond it. |

Quotes below come from the publisher's rule sheet.

## Rulebook rules (implemented as written)

| Rule | Rulebook wording (abridged) | Where |
| --- | --- | --- |
| Setup | "Deal four cards, face down, to each player in a 2x2 grid." | `RulesConfig.handSize` |
| Initial peek | "players can view their bottom two cards once" | `initialPeekSlots: [2, 3]` |
| First turn | the first player "draws a card … and can either discard it face up or exchange it" | Discard pile starts empty (`initialDiscard: false`) |
| Turn | "draw a card … from the deck **or discard pile** and exchange it with a card from their hand" | `drawDeck`, `takeDiscard`, `replace` |
| Abilities | a deck card "chosen not to exchange" can be "played directly into the discard pile allowing them to use the card's abilities". "Cards discarded from player's hands do not have abilities." Abilities are optional. | `discardHeld`, `skipAbility` |
| 7, 8 | "view one card in their hand" | `peekOwn` |
| 9, 10 | "view one card in one opponent's hand" | `peekOpponent` |
| 11, 12 | "swap any two cards on the table without viewing the cards" | `blindSwap` |
| 13 | "view any card on the table and choose to exchange the viewed card with another card, without viewing the other card" | `lookAndSwap` |
| 14 | "view any two cards on the table and choose to exchange the viewed cards" | `doubleLookAndSwap` |
| Swap scope | "players can swap cards between opponent's hands" | Any two occupied, unlocked slots |
| Matching | "At any time in the game, regardless of turn … match the last discarded card with a card from their hand or from an opponent's hand" | `match` |
| One attempt | "one attempt per discarded card" | Tracked per top-discard card |
| Opponent match reward | "you can choose a card from your hand to replace the card used to match from your opponent's hand. You may not view the card you give" | `give` interrupt; optional by default (`giveAfterOpponentMatch`) |
| Wrong own match | "return the card and take a penalty card from the deck … without viewing the card" | Penalty is appended face down |
| Wrong opponent match | "the opponent decides if the other player should take the mismatched card or return it and take a penalty card" | `mismatch` interrupt, owner decides |
| Wrong attempts public | "Incorrect attempts must be shown to the whole table." | All players learn the card |
| Calling | "In replacement of a turn, players can call 'KOMBIO' allowing their opponent's one more turn" | `callKombio` (start of turn only) |
| Caller lock | "The KOMBIO Caller's hand is locked from viewing, matching and swapping." "If playing 1v1, the KOMBIO Caller's hand is not locked." | `lockCallerHand: 'multiplayerOnly'` |
| Empty hand | "Reducing your hand to zero cards is an automatic 'KOMBIO' call." | Automatic call |
| Scoring | Caller lowest: caller gets hand score, others +10. Anyone ties or beats caller: caller +15, others get hand score. | `scoreRound` |
| Game length | "Play to a set number of rounds or set value. The lowest cumulative score wins." | `maxRounds`, `scoreLimit` (both off by default) |
| Add-ons | Both 14s and nothing else = −15. One 14 and a hand totalling exactly 25 = −10. | `addOnDoubleFourteen`, `addOnFourteenTwentyFive` (optional, off) |

## Not covered by the rulebook (unverified, configurable or documented)

| Topic | What the engine does | Why |
| --- | --- | --- |
| **Per-value deck counts** | −1 ×3, 0 ×3, 1–12 ×5, 13 ×2, 14 ×2 (70 cards) | Kept from the prototype. It matches the retail count of 36 "kombio" cards + 34 action cards. The rulebook confirms only that abilities are 7–14 and that there are two 14s. Configurable via `deck`. |
| **Deck exhaustion** | Shuffle the discard pile, minus its top card, into a new deck. Knowledge of reshuffled cards is cleared. | Kept from the prototype. Configurable via `reshuffleDiscardWhenDeckEmpty`. |
| Penalty with no card available | No penalty card is given (the event records `drawn: false`). | Not covered; no card is invented. |
| No legal move | When a player can't draw, can't exchange and KOMBIO has already been called, they may `pass`. | Rare edge case (empty hand + empty deck); prevents a deadlock. |
| Number of final turns | Every player except the caller gets exactly one more full turn, clockwise. A turn already in progress when the call happens (an automatic call during someone else's turn) doesn't count. | "their opponent's one more turn" is phrased for 1v1. |
| Automatic call timing | An automatic call doesn't end the current turn. Final turns start when that turn ends. | Not specified. |
| Matching while holding a card | The player whose turn it is can't match while holding a drawn card. Everyone else can. | Engine reading of "Players can only use one physical hand". |
| Matching the same value again | A successful match makes the matched card the new top discard. Everyone, including the matcher, gets a fresh attempt against it. | Follows from "match the last discarded card". |
| Lock scope | In 3+ player games the caller's own matches against their hand are also refused. | "locked from … matching" doesn't say by whom. |
| Dealer rotation | The dealer rotates clockwise each round. The first dealer is the last player, so player 1 starts round 1, as in the prototype. | Dealer selection isn't specified. |
| Add-on interaction | Add-on scores replace the hand score before the caller comparison and the +10/+15 adjustments. | Not specified. |
| Player count | 2–6 | Retail listings say 2–6. |
| Real-time matching | Single player approximates it: the CPU waits ~1.3 s before matching, so a fast human can win the race. | Real simultaneous matching needs the future multiplayer server. |

## Changes from the original prototype

These come from comparing the prototype with the rulebook. They aren't silent changes:

1. **No initial face-up discard.** The rulebook's first turn implies an empty discard pile. Set `initialDiscard: true` to restore the old behaviour.
2. **Matching works at any time**, including out of turn and during the opponent's ability, instead of only inside a turn-based window.
3. **Wrong match on an opponent's card:** the opponent now chooses the consequence. The prototype always moved the card to the matcher, and it also drew a penalty card that was then lost (a card-conservation bug).
4. **Giving a card after an opponent match** is now optional ("can choose"). The prototype forced it.
5. **Automatic KOMBIO** applies to every player who empties their hand, not only the human.
6. **The CPU takes the same turn structure as the human.** The prototype CPU never took the discard and used only the 7/8 abilities, and those at random.
7. **Card knowledge follows a card through a swap.** Everyone sees which positions were swapped. The prototype wiped knowledge on any swap.
