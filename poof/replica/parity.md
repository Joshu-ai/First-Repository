# Parity: Poof vs the original (core slice)

Scored with the replica-diff rules (must 3, should 2, could 1, partial half,
`skip` rows left out). Computed 2026-10-26 from `features.csv`.

**Feature score: 97 / 100. Must-haves: 14 of 14. Shippable for this slice.**

Missing (could-haves, in build order):
1. Group chats
2. Video snaps

Out of scope on purpose (not scored): Lenses/AR, the map, Discover/Spotlight,
avatars, screenshot alerts (a web page can't detect screenshots).

Layout diff was not run: there are no reference screenshots of the original
in `replica/screens/` (that needs your own account, by hand). The clone's
screens are in `clone-screens/`, captured by the e2e test at 390×844.

Brand sweep: no original names, domains or brand colour in the code or UI.
