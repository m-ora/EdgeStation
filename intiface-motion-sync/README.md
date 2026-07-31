# EdgeStation

A browser extension that watches videos and images on the current page and
drives Lovense toy(s) (via Intiface Central / Buttplug protocol v3) based on
on-screen motion — with a different vibration pattern per toy so multiple
devices don't just move in lockstep.

## How it decides intensity

- **Video**: every ~130ms it draws the currently visible, playing video onto
  a hidden 48x48 canvas and compares it to the previous frame. More pixel
  change = more motion = higher intensity. Paused, off-screen, or
  hidden-tab video contributes 0. (Bumped up from the original 20x20 canvas
  so the motion score has more resolution to work with.)
- **Images**: each panel/post gets analyzed for contrast, edge density, and
  saturation as it becomes visible or is swapped in by a reader — see
  "Image analysis" below for details, including the cross-origin caveat.
- If you have multiple tabs open with video/images, the tab with the
  strongest current signal "wins" and drives the output.
- The popup shows **what it's currently sampling** — the video filename (or
  page title, for streams without a plain file URL) or image name/alt text
  — right under the intensity meter.

**Cross-origin limitation**: browsers block reading pixel data from a
`<video>` served from a different origin without CORS headers (standard
browser security, not something an extension can bypass). When that
happens, that video falls back to a flat "playing = on" signal instead of
real motion analysis.

## Patterns (multiple toys, different behavior)

Each connected device gets its own pattern, editable per-device in the
popup:

- **Direct sync** — mirrors the raw activity level 1:1.
- **Pulse** — throbs at a rate that speeds up with more motion.
- **Wave** — a slower, smoother breathing-style ramp.
- **Alternating** — fixed 1Hz tempo shared by all "alternating" devices, but
  each device's phase is offset so they visibly take turns.
- **Random jitter** — a smoothed random walk, scaled by activity, for
  organic variation.

By default, if you have more than one device, they're auto-assigned
different patterns (cycling through the list above) so things are varied
out of the box — you can reassign any of them from the dropdown in each
device's row. All patterns still respect the global Sensitivity, Smoothing,
and Max intensity cap.

## Image analysis (doujin/manga readers, imageboards, galleries)

This does **not** try to identify what's in an image — no character, act, or
content-category detection, nothing semantic. What it does instead is
objective, contentless pixel statistics on each panel/post as it becomes
visible or gets swapped in:

- **Contrast** (how much luma varies across the image)
- **Edge density** (how much fine line-art/detail is packed in — a busy
  action panel scores higher than a flat establishing shot or a solid-color
  background)
- **Color saturation** (average vibrancy)

These three combine into a 0–1 "panel score" that replaces the old flat
pulse — so different images genuinely feel different instead of every panel
producing the same bump.

**Reading-pace pacing**: it also tracks the time between full-size panel
turns (page-to-page in a reader, post-to-post while scrolling an
imageboard) and uses the recent average gap to decide how long each pulse
should take to decay — flipping quickly gives you short pulses, lingering
on a page lets the level sustain longer instead of dropping off right away.

**Reader compatibility**: it catches both patterns readers commonly use —
a new `<img>` element appearing (infinite-scroll galleries, imageboard
threads) and a single `<img>`'s `src` attribute being swapped by
next-page/prev-page controls (most single-image manga/doujin readers do
this). Either one triggers a fresh analysis.

**Cross-origin limitation**: a lot of manga/doujin CDNs and imageboards
don't send CORS headers, which taints the canvas and blocks pixel reading
(standard browser security). When that happens for a given image, it falls
back to a rough size-based estimate (how much of the viewport the image
fills) instead of real pixel statistics — noticeably less varied, but still
functional. If you want to check which mode you're getting on a given site,
open the extension's service worker console and watch the incoming
`activity` messages' values for variety vs. a suspiciously flat pattern.

These panel scores feed into the same activity pipeline as video, so
everything from the per-device patterns to the session pacing and Ease off
behavior applies to image browsing exactly the same way it does to video.

## Edging session, Ease off, and learning

Below the intensity meter is a session panel:

- Set a **target duration** (minutes) and hit **Start**. Intensity builds
  gradually through the session, then ramps up harder in the final ~15%
  ("Finishing…") and pushes toward full in the last stretch ("Finish it") —
  the idea being it backs off through most of the session and only lets you
  finish once you're near your target time.
- **Ease off**, right under **Stop now**, is a soft, temporary cutback —
  not a full stop. One press immediately drops output to roughly a third of
  wherever it was and eases it back up over about 25 seconds. Press it
  again before it's recovered and the next cutback goes deeper and takes a
  little longer, since it assumes things escalated again quickly.
- If a timed session is running, every Ease off press is logged (how far
  into the session it happened, how intense things were at that moment).
  After a handful of sessions, EdgeStation starts backing off
  **proactively** as you approach that learned point in future sessions —
  the "learning" line under the session bar shows what it's picked up so
  far and a rough confidence percentage (confidence ramps up over your
  first ~8 logged presses). This is a simple running average over your own
  history, not a general "arousal detector" — it only ever learns from
  moments you've explicitly told it about by pressing Ease off, and it
  never fully cuts output on its own; it eases toward a floor, same as the
  manual button.
- This history is stored locally (`chrome.storage.local`) and never leaves
  your machine. There's currently no in-popup "clear history" button; if
  you want to reset the learned model, remove and reload the unpacked
  extension, or run `chrome.storage.local.remove('edgeHistory')` from the
  extension's service worker console (`chrome://extensions` → EdgeStation →
  "service worker" → Console).

## Pop-out window

The **⤢** button in the header opens the same panel in its own standalone
window (rather than the small popup that closes when you click elsewhere).
Handy for keeping controls visible while you browse. From the popped-out
window the button is hidden — close the window itself when you're done.

## Install (Chrome and Edge — same steps, both are Chromium)

1. Download/unzip this folder somewhere permanent (don't delete it after
   installing — unpacked extensions load from disk each time).
2. Chrome: go to `chrome://extensions`. Edge: go to `edge://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `intiface-motion-sync` folder.
5. Pin the extension icon for easy access.

## Setup

1. Open **Intiface Central**, and make sure the server is started (default
   `ws://127.0.0.1:12345`) with **Allow non-secure WebSockets** on for
   local connections.
2. Pair your Lovense toy(s) in Intiface Central (via Lovense Connect / the
   Lovense app bridge, as you already have it configured) and scan for
   devices.
3. Click the extension icon, confirm the address matches, and click
   **Connect**. Your device(s) will appear in the popup, each with an
   enable toggle and a pattern dropdown.
4. Adjust **Sensitivity**, **Smoothing**, and **Max intensity cap** to
   taste. Max intensity cap is a hard safety ceiling — nothing sent to any
   toy will exceed it regardless of sensitivity or pattern.
5. **Stop now** immediately sends a stop command to every connected device
   and zeroes the output, independent of the master toggle.

## Notes / things you may want to tune

- `SAMPLE_INTERVAL_MS` and `SAMPLE_SIZE` in `content.js` control sampling
  rate/resolution vs. CPU cost.
- The motion→activity multiplier (`avgDiff * 6`) in `content.js` and the
  image pulse strength (`0.5`) are rough starting points — real footage
  varies a lot in how much frame-to-frame change it has, so you'll likely
  want to nudge these once you see how it feels.
- Per-device pattern math lives in `computeDeviceOutput()` in
  `background.js` — frequencies, waveforms, and the golden-angle phase
  spacing are all tweakable there.
- Per-device command rate is capped at ~14Hz (70ms) in `background.js`.
- If the service worker goes idle and Chrome/Edge suspends it, the next
  activity message from `content.js` wakes it and it reconnects
  automatically (as long as it was connected before going idle).
