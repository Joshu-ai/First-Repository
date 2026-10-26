# Recon map: Snapchat (web clone)

Scope: the core loop — take a photo, mark it up, send it to friends so it
disappears after viewing; ephemeral chat; 24-hour stories; friends and streaks.
For: the repo owner, as a portfolio / starter product under its own brand ("Poof").
Date: 2026-10-26

Method: clean room. Built from public knowledge of how the app behaves (help
center articles, app store listing, public walkthroughs). No source code,
private APIs, assets, logos, colours or copy were used.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center | https://help.snapchat.com | snaps, chat, stories, friends, streaks behaviour |
| 2 | app store listing | https://apps.apple.com/app/snapchat/id447188370 | key screens, pitch |

Behaviour details (chat deletes 24h after viewing unless saved; streaks count
consecutive days of snapping back and forth) come from the help center's chat
and streaks sections (source 1).

## Core loop

Open straight to the camera, capture, add a caption or drawing, send to a
friend; the friend opens it once and it is gone.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Welcome / log in / sign up | first launch, logged out | account | form, button | empty, error, loading |
| S02 | Camera | default tab after login | capture | viewfinder, shutter, flip, nav bar | permission denied, no camera, live |
| S03 | Editor | after capture | caption, draw, timer | caption bar, pen + colour row, timer picker | blank, captioned, drawn |
| S04 | Send to | editor → send | pick recipients | friend checklist, My Story row, send bar | no friends, selected |
| S05 | Chat list | nav: chat | inbox per friend | row with status icon + streak | empty, new snap, opened, delivered |
| S06 | Snap viewer | tap a new snap | view once | full-screen image, countdown | loading, expired |
| S07 | Chat thread | tap a friend | text chat | bubbles, input, saved marker | empty, filled |
| S08 | Stories | nav: stories | friends' 24h stories | story rings, viewer with progress bars | none, unseen, seen |
| S09 | Add friends | header button | search + requests | search input, request rows | no results, pending |
| S10 | Profile | avatar button | identity, my story viewers, log out | header, list | — |

## Flows

```
F01 Send a snap
    S02 -> S03 -> S04 -> S05 (Delivered)
    happy path clicks: 3 (shutter, send, pick friend + send)
    edge: camera blocked (fall back to upload), no friends yet, image too large
F02 Open a snap
    S05 -> S06 -> S05 (Opened)
    edge: open twice (gone), timer ends, tap to close early
F03 Chat
    S05 -> S07, send text; message disappears 24h after the friend reads it unless saved
F04 Post and watch stories
    S03 -> S04 (My Story) ; S08 -> viewer, auto-advance, see who viewed mine (S10)
F05 Add a friend
    S09 search -> add -> (friend) accept
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, ghost, icon | default, focus, disabled | all |
| Bottom nav | 3 tabs | active | S02, S05, S08 |
| Friend row | inbox, picker, request | new, opened, delivered, selected | S04, S05, S09 |
| Story ring | unseen, seen, mine | — | S08, S10 |
| Countdown | ring | running | S06 |

## Inferred data model

```
User       id, username, display_name, password_hash, created_at     confidence: high
Friendship user_a, user_b, requester, status (pending | accepted)    confidence: high
Snap       id, from, to, media, duration (1-10s | no limit), created_at, opened_at
           media deleted on open                                      confidence: high
Message    id, from, to, text, created_at, read_at, saved            confidence: high
Story      id, user, media, created_at (expires 24h), viewers[]      confidence: high
Streak     pair, last day each side sent, count                      confidence: medium
```

Relationships: User n-n User (Friendship), User 1-n Snap, User 1-n Story.

## Feature matrix

See `features.csv`.

## Out of scope (cannot or should not be cloned)

- Lenses / AR face filters (needs a face-tracking engine; huge on its own)
- Snap Map (location sharing; needs a privacy design of its own)
- Discover / Spotlight (publisher content and creator network they own)
- Bitmoji (owned avatar system)
- Screenshot detection (not possible from a web page)
- The network and its users

## Size

Screens 10, flows 5, entities 6. Hard parts: camera on web, one-time media
delivery, realtime updates, streak rules. Size: M for this slice.
