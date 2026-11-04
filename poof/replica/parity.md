# Parity: Poof vs the original (core slice)

Scored with the replica-diff rules (must 3, should 2, could 1, partial half,
`skip` rows left out). Computed 2026-11-04 from `features.csv`.

**Feature score: 95.8 / 100 (103.5 of 108 points). Must-haves: 15 of 15. Shippable for this slice.**

Partial (counted half): scanning a profile code in the app, and the camera
spotting one, need the browser's code reader (`BarcodeDetector`), which
Safari, Firefox and desktop Chrome on Windows and Linux do not have. There
the app says to use the phone's camera app, which opens the code's link.

Also partial: the back camera's flash and tap to focus rely on camera controls
that only some browsers give a web page (the light's `torch` switch and a
focus `pointsOfInterest`, both Chrome on Android). Elsewhere the focus ring
still shows, the front camera's screen flash still works, and a back camera
that cannot be lit says "This camera has no flash."

Also partial: saving a snap to the device works for photos; videos can't be
saved yet.

Gestures are in: swipe sideways between Chat, Camera and Stories (the screen
follows the finger and snaps over or back), tap through snaps and swipe them
down to close, tap the sides of a story, hold to pause it, swipe it down to
close, swipe a chat row right to open the chat, press and hold a row for
the friend card (with Remove friend), and pull down on the Chat or Stories
list to refresh it, Puff showing above it. Escape closes viewers and sheets.

The typing indicator is in: while a friend types, their open thread shows
their avatar and moving dots with "<Name> is typing…", and their Chat list
row says Typing…, until 4 seconds after they stop or their message arrives.

Video snaps are in: hold the shutter to record up to 10 seconds, a caption
and Mute in the video editor (Mute takes the sound out of the file itself),
open once, and stories play video. Drawing on a video is not built.

Group chats are in: New chat on the Chat list picks friends (one opens
your chat with them; two or more, or a name, start a group of up to 32
people), group rows show two stacked avatars and the usual statuses, the
group's chat puts the others' messages under their names and avatars, and
messages go 24 hours after everyone else has read them. Send to lists your
groups, and each member opens a group snap once. The group card lists who
is in it, with Leave group; the last one out deletes it. Not built: adding
people or renaming a group after it is made, and typing in groups.

Missing (could-haves): none.

Out of scope on purpose (not scored): Lenses/AR, the map, Discover/Spotlight,
avatars, screenshot alerts (a web page can't detect screenshots).

Layout diff was not run: there are no reference screenshots of the original
in `replica/screens/` (that needs your own account, by hand). The clone's
screens are in `clone-screens/`, captured by the e2e test at 390×844.

Brand sweep: no original names, domains or brand colour in the code or UI.
