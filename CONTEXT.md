# Simple Video Editor

A browser-based video editor where the AI (Claude) analyzes a set of uploaded
video clips, discovers a story across them, sequences and captions them, and
exports a single finished video.

## Language

**Author**:
The person operating the editor — the only human role in this domain. They name
the Project, supply Direction and Creator Notes, and own every claim the finished
video makes. Not the Writer, which is the AI.
_Avoid_: user, creator, editor

**Writer**:
The AI that drafts a Script from what the Author supplied. It proposes; the
Author disposes. Distinct from the Author, who is always the human.
_Avoid_: author, AI, Claude, generator

**Writer Prompt**:
The full instruction the Writer receives. Normally composed from the Author's
Direction, Tone, Stance and emphasis choices; the Author may replace it outright,
which detaches those controls until it is reset.
_Avoid_: prompt, instructions, template, system prompt

**Project**:
The whole editing session — its Clips, Direction, Tone, Story, and Cut, plus the
export settings. The thing the author names (its Title) and clears with "Start
over". Larger than the Cut, which is only one part of it.
_Avoid_: file, document, timeline

**Title**:
The Project's name; blank shows "Untitled project", and it names the exported
files. Not the export's **Title overlay** (the optional title card burned over
the video) — that is a separate thing.
_Avoid_: filename, heading, title overlay

**Clip**:
A single uploaded source file — the raw input unit the editor works with. Either
video footage or a Still.
_Avoid_: video, footage, asset

**Still**:
A Clip imported from an image (JPG/PNG/WebP/GIF/AVIF) rather than a video. It
has no natural length, so ingest gives it a synthetic 10-second duration and
every consumer treats it as a 10-second source (ADR-0012). Added to a Beat it
runs the full 10s. Distinct from a Sticker, which is an image laid *over* the
Cut rather than being the Beat's own footage.
_Avoid_: photo, image clip, static

**Story**:
The coherent narrative arc the editor discovers across the Clips. Discovered
from clip content by default; may be steered by an author-supplied Direction.
_Avoid_: narrative, plot

**Practice Story**:
An Author-written or pasted story used for rehearsal and coaching, independent
of the Project's generated Story and Cut. Reviewing one never changes the Cut
unless the Author later copies material into it.
_Avoid_: Story, Script, draft Cut, prompt

**Coach**:
The AI when it evaluates a Practice Story and teaches the Author how to improve
it. Distinct from the Writer, which drafts a Script; the Coach diagnoses,
explains, suggests, and assigns a next practice challenge.
_Avoid_: Writer, generator, critic, grader

**Story Step**:
One structural job inside a Practice Story: Hook, Beginning, Problem, Journey,
Resolution, or Ending. Problem + Journey + Resolution make the story's middle;
the steps are coaching lenses, not Cut Beats and not a required formula.
_Avoid_: Beat Purpose, Beat, chapter, scene

**Coach Review**:
The Coach's structured response to a Practice Story: overall and per-step
scores, strengths, the highest-leverage improvement, concrete suggestions,
example rewrites, and a next practice challenge. It builds skill rather than
silently replacing the Author's voice.
_Avoid_: analysis, grade, generated story, verdict

**Direction**:
An optional author-supplied, free-text steer for the Story's angle and emphasis
("build the tension, save the best for last"). The editor is a curator by
default; Direction makes it a collaborator. Distinct from Tone: Direction shapes
*what* the Story says; the two compose.
_Avoid_: brief, prompt, instruction, tone

**Tone**:
The voice/mood register applied to the Story's Script — a bounded preset (casual,
hype, chill, funny, cinematic, informative, heartfelt). Composes with Direction:
Tone shapes *how* the Story sounds. Applies to the Script's voice only; the Clip
Description stays neutral and factual.
_Avoid_: mood, style, vibe, direction

**Stance**:
How favourable a product review's Script is toward the product — favourable,
balanced, or critical. It decides which recorded material leads, never what
material exists, so it can foreground the Author's cons but never invent one.
Distinct from Tone, which sets how the Script sounds, and Direction, which sets
what it says.
_Avoid_: tone, angle, slant, bias, sentiment

**Product Brief**:
The editable, source-attributed facts about the product being reviewed, imported
from a seller listing or entered by the author. It describes the product, not
the author's experience of using it.
_Avoid_: product details, listing data, review

**Product Feature**:
One stated capability of the product, carried by the Product Brief and always
attributed to where it came from — a seller listing or the Author's own entry.
The attribution is load-bearing: a listing-sourced Feature is what the seller
asserts, never an independently verified fact.
_Avoid_: claim, spec, bullet, selling point

**Creator Notes**:
The Author's own observations, verdict, audience, disclosure, and talking points
for a product review. The only source for claims about personal experience.
"Creator" names this artifact, not a second human role — the Author fills it in.
_Avoid_: review notes, product facts, prompt, Author Notes

**Evidence**:
The Creator Note a Script line draws on, naming the Author as the source of what
the line says. It is what permits first-person language; a line that speaks for
the Author without it is discarded. Factual lines carry none — a Product Feature
is context the Writer may describe, never backing for a personal claim.
_Avoid_: source, citation, grounding, proof

**Review Plan**:
A Writer-proposed product-review structure made from a Script and a Shot List,
built from a Product Brief and Creator Notes but grounded only in the latter. It
remains a proposal until the Author applies it to the Project.
_Avoid_: review, draft Cut, template

**Hook**:
The Script's opening line — the one the reel leads with, chosen by the Author
from alternatives the Writer proposes. A product review's Story takes its logline
from the Hook.
_Avoid_: logline, opener, intro, teaser

**Beat Purpose**:
The editorial job a Beat performs in the Story: Hook, Problem, Proof, Payoff, or CTA. It describes why the Beat is present, not what its Clip shows.
_Avoid_: role, phase, section, label

**Story Spine**:
The ordered Beat Purposes across a Cut. It exposes the Story's structure without changing the Cut's Beat order, Clips, timing, or Script.
_Avoid_: outline, framework, arc labels, beat map

**Shot List**:
The ordered footage the author should capture or match from existing Clips to
realize a Review Plan. A Shot is a request for footage; a Beat is footage already
placed in the Cut.
_Avoid_: Cut, Beat list, storyboard

**Clip Description**:
Claude's own understanding of what a single Clip contains, generated by looking
at sampled frames — subject/action, setting/mood, and a usability rating. A
neutral *description* of the footage, never coaching aimed at the creator. The
primary signal the Story is built from — clips are not assumed to contain speech.
_Avoid_: analysis, summary, tag, metadata, coaching, advice, vlog move

**Script**:
The written narrative for the Story — voiceover-ready prose, segmented so each
segment maps to a Clip. A Script segment has up to three renderings: it is spoken
in-app as a Voiceover, shown on-screen as a Caption, and exportable as narration
text (`.txt`/`.srt`) for an external voice platform.
_Avoid_: narration, screenplay

**Caption**:
The on-screen text rendering of a Script segment over its Clip in the finished
video. Distinct in role from the spoken Voiceover, but in v1 a Caption shows its
Script segment verbatim — there is no separate on-screen wording yet.
_Avoid_: subtitle, title card

**Overlay**:
A Clip composited over the Cut on its own lane, with its own in/out points, a
blend mode (normal, screen, multiply, overlay) and an opacity. Unlike a Beat it
does not advance the Cut — it plays *on top of* whatever Beats it spans. Its
blend mode is load-bearing (see ADR-0009).
_Avoid_: B-roll, layer, PiP

**Sticker**:
An image (PNG/SVG/WebP) placed over the Cut on its own lane, with its own start
and duration, positioned freely and given a scale and a rotation. The asset comes
from the author's `stickers/` folder; the placement is what lives in the Cut, so
one asset can be placed many times. Unlike an Overlay it is not a Clip and
carries no audio; unlike a Title overlay it is not text.
_Avoid_: overlay, decal, graphic, emoji, image overlay

**Title overlay**:
The optional title card burned over the video — text laid out by the shared
canvas renderer (ADR-0008) and composited on top. Distinct from the Project's
Title, which is only its name, and from an Overlay, which is a Clip.
_Avoid_: title, title card, caption

**Voiceover**:
The spoken rendering of the Script, synthesized inside the app (see ADR-0006) —
optional, and off unless the author turns it on. When on, its length is the
master clock for a Beat's on-screen duration (ADR-0004). The app owns the voice
and the mix now; it is no longer a text hand-off to an external tool.
_Avoid_: narration, TTS, audio

**User voice recording**:
Human speech recorded from a microphone or imported as an audio file and placed
on the independent User VO lane. It is distinct from Voiceover, which is the
app-synthesized rendering of the Script. “User VO” is the compact UI label only;
domain code uses `UserVoiceSegment` to keep the two sources unambiguous.
_Avoid_: Voiceover, generated VO, narration

**Music bed**:
Optional background music under the finished video — looped and trimmed to length,
and ducked beneath the Voiceover. The app arranges the track but does not source
it; the author supplies it.
_Avoid_: soundtrack, score, BGM

**Look**:
A named, reusable colour style — either built in or derived by Claude from an
author-supplied reference image. A Look is a *target* the Beats are carried
toward, not an offset added on top of them (ADR-0010). Saving a Look under a name
is all a "preset" is; it is not a separate concept.
_Avoid_: filter, filter preset, film look, style, LUT

**Grade**:
The colour adjustment values carried by a single Beat — the bounded ±100 axes
that move that Beat toward a Look. Each Beat gets its own Grade, because clips
shot differently need different corrections to land in the same place. The axes
fall in three groups: overall (exposure, contrast, saturation, hue, white
balance), **tonal range** (Shadows and Highlights — brightness of the dark and
bright regions, each holding its own end of the scale), and **split tone**
(warmth/tint applied to shadows and highlights separately — colour in those same
regions, not brightness).
_Avoid_: color adjustments, correction, filter, tweak

**Cut**:
The assembled, editable draft — the ordered sequence of Beats that the user
refines and exports as a single video. Claude proposes the first Cut; the user
refines it.
_Avoid_: timeline, sequence, project, edit

**Beat**:
One entry in the Cut: a single Clip trimmed to an in-point and out-point, paired
with the Script segment shown over it as a Caption. The atomic story-and-edit
unit. A Clip may be dropped (unused) but appears in at most one Beat; Beats are
not split or reused in v1.
_Avoid_: segment, shot, scene, track item

**Layer**:
Something laid **over** a Beat's picture rather than being it: a Caption, a Title
overlay, a B-roll Overlay, or a Sticker. All four are placed on top of finished
footage and can be added or removed without changing the shot underneath.
Zoom, Ken Burns, rotation and the Grade are **not** Layers — they decide what the
shot itself looks like (ADR-0016).
_Avoid_: effect, element, track, composite

**Zoom**:
A Beat's **static** framing: how far the frame is punched in, and on what point.
It holds one position for as long as it is active — it does not travel. Its
scope is either the whole Beat or only its opening seconds, and when that scope
expires the framing returns to full. Distinct from a Sticker's scale, which
sizes an overlaid asset rather than the footage itself.
_Avoid_: crop, scale, punch-in, magnify

**Ken Burns**:
A Beat's **moving** framing: the frame travels from one position to another
across the Beat, drifting and pushing in or out rather than holding still. It
exists because a Still has nothing else to give the eye — the picture does not
change, so the framing must. A Beat's framing is either a Zoom or a Ken Burns,
never both, because the two command the same thing. Available on Still Beats
only for now.
_Avoid_: pan, zoom, animation, motion, effect

**Speed**:
How fast a Beat's footage plays relative to its source — 1× is untouched, lower
is slow motion, higher is fast motion. It sets how long the Beat runs: the Beat
lasts exactly as long as its footage takes to play at that Speed (ADR-0020), so
slowing one lengthens it and the Cut with it. Unavailable on a Still, whose
picture is the same at any Speed.
_Avoid_: rate, slow motion, time stretch, playback rate

**Fill**:
What a Beat shows if it ever outlasts its footage — the last frame holds, or the
trim window loops. Vestigial: a Beat is now sized to its footage (ADR-0020), so
it cannot outlast it. The term survives because Projects saved earlier still
carry the choice.
_Avoid_: stretch, padding, freeze, hold, loop

**Cover**:
A still image dressed to advertise the Project — carrying its own framing, Grade,
Veil, Stickers and Title overlays, and exported at its own aspect. Its picture is
either captured from a Beat or supplied by the Author from a file; once taken it
keeps those pixels rather than pointing back at where they came from, so
retrimming, reordering or deleting a Beat never disturbs a Cover made from it
(ADR-0021). The origin survives only as a label, because nothing about a Cover
behaves differently for one or the other. A Project holds many and none is
preferred: nothing in the app reads a Cover, so there is no "chosen" one.
Distinct from the Cut, which is the video itself; from a Beat's poster thumbnail,
which is only a small UI preview; and from a Still, which is a Clip the Cut can
build a Beat from — an uploaded Cover picture never enters the Cut.
_Avoid_: thumbnail, poster, screenshot, cover image

**Veil**:
A solid or linear-gradient colour laid over a Cover's picture, beneath its
Stickers and Title overlays. It exists so the photograph recedes and the text
above it reads. A Cover has at most one. Distinct from Colorize, which moves the
colours the picture already has in its own shadows and highlights; a Veil is a
new colour laid on top of everything the Grade produced, and it dims the
photograph without touching the Stickers or Titles above it.
_Avoid_: scrim, wash, fill, tint, gradient, overlay

## Working docs & known issues

Root-level living docs that track cross-cutting bugs, their fixes, and rules to
avoid re-introducing them. Check these before re-diagnosing a related problem.

- [EXPORT_OVERLAY_AUDIO_ISSUE.md](./EXPORT_OVERLAY_AUDIO_ISSUE.md) — ✅ RESOLVED. Export
  overlays/audio not matching preview; ffmpeg.wasm filtergraph fixes + "do not
  re-try" list. Magenta + timeout root causes fixed. (Stages: `seg → … → overlaid → final`.)
- [PREVIEW_BLACK_SCREEN_PREVENTION.md](./PREVIEW_BLACK_SCREEN_PREVENTION.md) — ✅ fixed.
  Blob-URL lifecycle + async-seek causes of the black preview screen.
