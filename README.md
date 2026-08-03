# lil blurb

I really wanted something to goon with on any videos, and I hate the vibemate app / extension it sucks and the browser was better so I just asked claude to do this shit for me.
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

## Motion-diff methods

Video and screen capture both work by comparing two consecutive frames;
there's more than one reasonable way to turn "these two frames differ" into
a single number, so it's selectable in Settings → **Motion-diff method**:

- **Average** (default) — whole-frame average luma change. General
  purpose, catches everything including flicker/fades, smoothest result.
- **Edge** — diffs edge-strength maps rather than raw brightness, so it
  responds to shapes/subjects actually moving and is comparatively
  unbothered by pure brightness changes (fades, flashes, color washes).
- **Block** — splits the frame into a 6×6 grid and looks at the *variance*
  between blocks' changes, not just the overall average — favors localized
  motion (something moving in one part of the frame) over uniform
  whole-frame change like a camera pan or a fade.
- **Peak** — takes a high percentile of per-pixel change instead of the
  average, so a small fast movement registers at close to full strength
  instead of getting diluted by the mostly-static rest of the frame.
  Noisier and twitchier than the others, most reactive to quick motion.

All four operate on the exact same downscaled pixel data (Canvas size
setting still applies to all of them) — this only changes the math that
turns those pixels into a score, not what gets sampled. It only affects
video and screen capture; image-panel scoring uses its own separate
contrast/edge/saturation analysis regardless of this setting (see "Image
analysis" below).

## Ambient mode

Runs the toy(s) on their own smooth, self-generated rhythm instead of
syncing to anything on screen — for when you want it to just edge you on
its own. Turn it on in the **Ambient mode** panel; the **Rhythm length**
slider sets how long one full breathing cycle takes (6–40s).

Under the hood it's two slow sine waves summed together — smooth by
construction (no way for a sum of sines to jump abruptly), with a second,
slower, out-of-step wave layered in so it drifts rather than repeating
identically every cycle. That breathing level then flows through the exact
same pipeline as page-driven activity: each device's assigned pattern
(Pulse, Wave, Throb, Rolling, etc.) still layers its own faster texture on
top, session build/finish pacing, Ease off, partner blending, and the Max
intensity cap all apply to it exactly the same way.

One real constraint: it needs **at least one browser tab open** (any page,
content doesn't matter) to keep time, since that's what actually drives the
timing under Chrome/Edge's extension model — there's no persistent
always-on timer available to a background extension otherwise. If every tab
closes, ambient mode pauses until one's open again.

## Denial mode

A ceiling under your Max intensity cap, with occasional smooth spikes
toward the edge — a tease, not a full release. Turn it on in the **Denial
mode** panel:

- **Ceiling** — the normal cap, as a percentage of Max intensity (10–90%).
- **Tease frequency** — roughly how often a spike happens (the actual
  timing is randomized around this average, so it's not clockwork-
  predictable).
- **Roulette** — when on, spikes have a chance of being a sudden drop
  toward near-nothing instead of a tease toward the ceiling, picked at
  random each time. Off, every spike is a tease.

Every rise and fall is cosine-eased — smooth by construction, same
principle as Ambient mode's breathing curve, nothing snaps. A spike's shape
is: ease up over ~1-1.8s, hold briefly near the peak (or floor, for a
roulette drop), then ease back down over ~2.5-5s.

Denial is a ceiling on whatever's *already* driving your toy — it doesn't
generate activity on its own. Pair it with Ambient mode or real content;
with both off and nothing playing, there's nothing for it to cap.

## Tab-away

In Settings → **When you look away**: change what happens based on whether
the browser window itself has focus (e.g. you alt-tabbed to check
something else).

- **Off** — no change (default).
- **Drop to near-silent** — fades down while you're away, fades back to
  normal when you return.
- **Ramp up** — the opposite: intensity pushes up while you're away, easing
  back to normal once you're back. Still hard-capped by your Max intensity.

Both directions transition smoothly over about 1.6 seconds each way. Like
Ambient mode, this needs at least one tab open to animate — it's watching
window focus, not any specific page.

## Release trigger

A **Finish now** button, plus an optional phrase you type instead — for
gating a release behind a deliberate action rather than just time elapsed.

- **Set a phrase** once in the panel (type it, hit Save). Later, typing that
  same phrase and hitting Submit — or just pressing **Finish now** — counts
  as triggering it. Use "change" to clear it and set a new one.
- **Gate session finish behind this**: with a timed Edging session running,
  turning this on means the session's normal build-up-then-finish escalation
  *holds* at its running level even after the timer runs out, until you
  actually trigger a release. Once triggered, it lets the session's normal
  finishing escalation proceed as usual for the rest of that session.
- With **no session running**, triggering it does its own thing instead: an
  ~18 second smooth ramp up toward a high level, as a one-off release,
  independent of everything else. It resets after that window — trigger
  again for another.

Works best with something else already keeping the rhythm going (Ambient
mode, real content, or Tab-away mode) — like the other rhythm-dependent
features, the smooth ramp needs a steady heartbeat to animate against. With
absolutely nothing else running it may still apply, just in fewer, choppier
steps rather than a fully smooth ramp.

## Audio-reactive

Off by default — analyzes loudness and beats in whatever video/audio is
playing on the page (moans, music, ASMR, game audio) as an activity source,
competing with video motion and image analysis the same way those two
already compete with each other (whichever's currently most active wins).
Turn it on in the **Audio-reactive** panel.

When it detects a steady beat, a **BPM readout** appears next to the
sampling line, and the Pulse, Alternating, and Throb patterns lock their
tempo to it instead of deriving frequency from activity level — so a device
running Pulse will actually throb in time with the music/beat rather than
just responding to overall loudness.

This is more invasive than the canvas-based video/image analysis — it
reroutes the media element's audio output through the Web Audio API (still
reconnected back to actually play out loud, just also analyzed along the
way) — so it stays strictly opt-in. Real limits, inherent to the browser
APIs involved, not bugs:

- **DRM-protected streaming** (most paid video/music services) blocks this
  outright — the browser won't allow it, full stop.
- **Cross-origin media without CORS headers** taints the same way video
  motion and image analysis do elsewhere in this extension — no usable
  data, silent fallback to 0.
- Beat detection is a simple energy-based onset detector (bass-band energy
  vs. its own rolling average, with a refractory period) — it works well on
  music with a clear beat, less reliably on speech-only or ambient/no-beat
  audio, in which case you'll just get the loudness-based activity level
  with no BPM lock.

## Screen capture

Reacts to your actual screen — not just page elements — using the
browser's `getDisplayMedia()` API, the same one video-call apps use to
share your screen. Same motion-diff and beat-detection math as the
video/audio analysis above, just pointed at a screen/window/tab capture
instead of a page element.

**Only works from the pop-out window.** `getDisplayMedia()` needs a
persistent top-level page to keep the stream alive — the small action
popup closes the moment you click anywhere else, which would kill the
capture immediately. The panel shows a shortcut to pop out if you're not
there yet.

To use it: pop out, open the **Screen capture** panel, choose whether to
**Include audio**, and hit **Share screen**. Your browser/OS shows its own
picker (screen, a specific window, or a tab) and its own persistent
"stop sharing" indicator the entire time it's active — that's the browser
itself, not this extension, and it's how you can always tell at a glance
whether it's running. Hitting **Stop sharing** here, clicking the browser's
own stop indicator, or just closing the pop-out window all end it
immediately.

Analyzed entirely locally, exactly like everything else in this
extension — motion and audio energy reduced to a single 0–1 number,
nothing recorded, nothing sent anywhere except that number to the
background worker. If a partner is connected, they only ever see that
number too, labeled generically as **"Screen capture"** — deliberately
never a window title, URL, or anything else that could identify what's
actually on screen.

The panel includes a small live preview of exactly what's being analyzed
(the same downscaled canvas used for the pixel diffing, just rendered
visibly instead of only read from) — mostly so you can see it's actually
working, at a resolution far too low to make out real detail.

## A note on feel

If you're upgrading from an earlier version: patterns used to only swing
across roughly the top 60–70% of their range (e.g. 30%–100% of whatever
level was available), which at moderate activity reads as "sitting at a
percentage with a bit of wobble" rather than an actual pulse. They now swing
from near-silent up to the same peak. Also, the **Sensitivity** slider used
to go dead across most of its top half — a shaping curve applied before
sensitivity meant many raw values were already saturated near maximum
before sensitivity even got multiplied in, so cranking it past ~2x often did
nothing. Sensitivity now works as an exponent applied directly to the raw
signal instead of a separate multiply, so every point on the slider has a
visible effect: 1.0 is neutral, higher pulls weaker motion up harder, lower
requires stronger motion before much registers. New installs also default
to slightly higher Sensitivity (1.8x) and lower Smoothing (25%) for a
snappier out-of-the-box feel — if you're on an existing install, your saved
settings won't change automatically, so it's worth nudging those two
sliders yourself (Settings panel) to get the same effect. Also worth
checking: if a device is set to the **Direct sync** pattern, that one's
deliberately flat by design (mirrors the raw level with no waveform at all)
— it's no longer auto-assigned by default, but if you'd picked it manually,
that'll be why it feels static.

## Patterns (multiple toys, different behavior)

Each connected device gets its own pattern, editable per-device in the
popup — 10 total:

- **Direct sync** — mirrors the raw activity level 1:1.
- **Pulse** — throbs at a rate that speeds up with more motion.
- **Wave** — a slower, smoother breathing-style ramp.
- **Alternating** — fixed 1Hz tempo shared by all "alternating" devices, but
  each device's phase is offset so they visibly take turns.
- **Random jitter** — a smoothed random walk, scaled by activity, for
  organic variation.
- **Throb** — like Pulse but shaped to have sharper peaks and softer
  troughs, reading as heavier/deeper.
- **Burst** — a quick spike then a rest, repeating, instead of a smooth
  wave.
- **Escalating** — a linear ramp up, then a hard reset — a rising staircase
  rather than a symmetric wave.
- **Heartbeat** — two narrow lobes per cycle ("lub-dub") instead of one
  smooth peak.
- **Rolling** — two slightly-mismatched sine waves summed together, so it
  drifts in and out of phase with itself instead of repeating cleanly.

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

### Canvas size

Both the video-motion and image-analysis sampling use a shared square
canvas whose size you can set in the popup (Settings → **Canvas size**,
16–96px). Bigger gives finer-grained pixel diffs and more variation in the
score, at more CPU cost per sample; smaller is cheaper and coarser. It
applies live — changing it mid-session resizes any canvases already in use
without needing a page reload.

## Safety fallbacks

Two things that don't need any setup, on by default:

- **Dead-man's switch** — if nothing has reported activity in about 30
  seconds (a tab crashed, the pop-out window hung mid-capture, every tab
  closed while Ambient/Denial/Tab-away was running) and a device is still
  running, everything gets stopped automatically. This uses
  `chrome.alarms`, which wakes the extension independently of any tab —
  necessary, since a purely reactive check couldn't notice anything once
  nothing's left to trigger it. Chrome clamps alarm periods to roughly once
  a minute for installed extensions, so this is a backstop with up to ~1
  minute of latency, not an instant cutoff. If it fires, a banner appears at
  the top of the popup.
- **Global stop hotkey** — <kbd>Ctrl+Shift+X</kbd> (<kbd>⌘+Shift+X</kbd> on
  Mac) stops everything instantly from anywhere, no need to find and open
  the popup first. Rebind it at `chrome://extensions/shortcuts` if it
  conflicts with something else. This is the fast path; the dead-man's
  switch above is the slow, automatic backstop for when you can't hit a key
  at all.

## Presets

Save your current setup — intensity/pattern-related settings like
Sensitivity, Denial, Ambient, Tab-away, Motion-diff method, etc. — as a
named preset in the **Presets** panel, and load it again later in one
click. Three built in to start from:

- **Simple sync** — everything extra off, just plain video/image/audio
  sync at reasonable defaults.
- **Denial session** — Denial mode on with Roulette, a moderate ceiling,
  and the session finish gate on.
- **Full chaos** — Ambient, Denial+Roulette, Audio-reactive, and
  ramp-on-tab-away all running together.

Deliberately **not** included in presets: your Intiface/relay addresses,
connection state, per-device pattern assignments (device indices aren't
stable across Intiface sessions anyway), and your Release phrase — those
stay exactly as they are when you load a preset.

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
  your machine. Hit **Reset learning** at the bottom of the Edging session
  panel to clear it — asks you to confirm first, since it can't be undone.

## Partner sync

Lets two people sync toys to each other, over a relay you (or your
partner) run yourselves — see `/relay-server` for the tiny server this
needs and deployment options.

1. One person picks a **Relay address** and clicks **Create code** → gets a
   6-character code.
2. They share that code with their partner (any messaging app — it's just
   text).
3. The partner enters the same relay address plus that code and clicks
   **Join**. Both sides now show "Connected."

Once connected, each side continuously sends the other a small
`{ value, label }` update — nothing else, never screen content, just the
same 0–1 intensity number and short label already used for your own toy.
The **Partner influence** slider controls how much of *your* toy's output
comes from your own browsing vs. your partner's: 0% ignores them entirely,
100% fully mirrors them, and anything in between blends the two.

**Your own Max intensity cap always applies as a hard ceiling**, regardless
of blend or what your partner's side sends — nobody can push you past your
own configured limit. Partner sync also works with no local video/images
open at all — if your partner's data is coming in, your devices respond to
it on its own.

A couple of things worth knowing:

- Only share the room code with the specific person you want to sync
  with — anyone with the code and relay address can join that session.
- The relay only ever forwards numbers between exactly two peers; it
  doesn't store anything, but it does *see* the intensity values in transit
  the moment they pass through, so only use a relay you (or your partner)
  actually control. See `/relay-server/README.md` for self-hosting options,
  including quick tunnels for testing without a full deployment.
- Leaving and reconnecting gets you a new code each time — codes aren't
  meant to be reused across sessions.

### Remote actions

While connected, you can also let your partner remotely trigger your
**Finish** or toggle your **Ambient mode** — off by default, opt in with
"Let them trigger my Finish / toggle my Ambient mode" in the panel. It only
ever runs in the direction you've explicitly allowed: if they try it while
you have this off, nothing happens on your end, and a note appears in your
panel saying they tried. The two buttons in your own panel do the same
thing to *their* side (subject to their own opt-in). The relay just
forwards a plain action name (`finish` or `ambient-toggle`) — same
minimal-data-in-transit principle as the intensity numbers.

## Data & privacy

Everything — settings, learning history, saved presets — is stored locally
via `chrome.storage.local` and never leaves your machine, except the single
intensity number (and, if you opt in, a remote action name) shared with a
connected partner over your chosen relay. Two ways to clean up:

- **Reset learning** (in the Edging session panel) clears just the learned
  ease-off timing history.
- **Clear all data** (in the Data panel) resets every setting to default,
  clears learning history and saved presets, and disconnects Intiface and
  any partner sync. Asks for confirmation first — this can't be undone.

## Collapsible panels

Every panel has a header you can click to shrink it — useful once
everything's dialed in and you just want the popup to take up less space.
Collapsed panels still show a small status badge in the header (current %,
session phase, partner state, device count, etc.) so you're not flying
blind. On a fresh install, everything collapses by default except
Connection, Live intensity, and Devices & patterns — 13 panels all expanded
at once is a lot to take in; once you've toggled anything yourself, your
own choices take over completely. Which panels are collapsed is remembered
across opening the popup again, and shared with the pop-out window.

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
