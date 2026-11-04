# Parity: Poof vs the original (core slice)

Scored with the replica-diff rules (must 3, should 2, could 1, partial half,
`skip` rows left out). Computed 2026-11-04 from `features.csv`.

**Feature score: 94 / 100 (83 of 88 points). Must-haves: 15 of 15. Shippable for this slice.**

Partial (counted half): scanning a profile code in the app, and the camera
spotting one, need the browser's code reader (`BarcodeDetector`), which
Safari, Firefox and desktop Chrome on Windows and Linux do not have. There
the app says to use the phone's camera app, which opens the code's link.

Also partial: the back camera's flash and tap to focus rely on camera controls
that only some browsers give a web page (the light's `torch` switch and a
focus `pointsOfInterest`, both Chrome on Android). Elsewhere the focus ring
still shows, the front camera's screen flash still works, and a back camera
that cannot be lit says "This camera has no flash."

Missing (could-haves, in build order):
1. Group chats
2. Video snaps

Out of scope on purpose (not scored): Lenses/AR, the map, Discover/Spotlight,
avatars, screenshot alerts (a web page can't detect screenshots).

Layout diff was not run: there are no reference screenshots of the original
in `replica/screens/` (that needs your own account, by hand). The clone's
screens are in `clone-screens/`, captured by the e2e test at 390×844.

Brand sweep: no original names, domains or brand colour in the code or UI.
