import type { Dispatch } from "react";
import type { Action } from "../state/projectReducer";
import type { Clip, Cut, Story } from "../domain/types";

// Dev-only fixture so the populated workspace can be exercised without importing
// real footage or calling the AI. Gated behind import.meta.env.DEV + ?seed in
// StudioApp — never runs in production.

function poster(a: string, b: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='320' height='180' fill='url(%23g)'/></svg>`;
  return "data:image/svg+xml," + svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
}
const file = (name: string) => new File([new Uint8Array(1)], name, { type: "video/mp4" });

interface Seed { name: string; dur: number; a: string; b: string; subj: string; mood: string; use: number; cap: string; in: number; out: number }
const S: Seed[] = [
  { name: "sunrise_ridge.mov", dur: 42, a: "#f7b267", b: "#3d405b", subj: "A cold ridge line catches the first warm light of day.", mood: "Pre-dawn alpine, still and expectant.", use: 5, cap: "First light hits the ridge.", in: 3, out: 7 },
  { name: "trailhead_start.mp4", dur: 75, a: "#bfd77e", b: "#2e5233", subj: "Two hikers shoulder packs and start up a shaded forest trail.", mood: "Green early morning, soft light.", use: 3, cap: "We set out before the crowds.", in: 12, out: 17.2 },
  { name: "river_crossing.mov", dur: 38, a: "#9bd7ea", b: "#0a3b52", subj: "A hiker steps across rocks in a fast, shallow river.", mood: "Cold teal water, deep shade.", use: 4, cap: "The only way up is through.", in: 5, out: 8.8 },
  { name: "summit_push.mp4", dur: 123, a: "#cdd3da", b: "#495057", subj: "A hiker pushes up a steep scree slope, poles planted.", mood: "High alpine, thin air, overcast.", use: 5, cap: "The last stretch is always the steepest.", in: 48, out: 54.1 },
  { name: "summit_pano.mov", dur: 88, a: "#bfeaf7", b: "#3a93b4", subj: "A slow pan across a vast sunlit range from the summit.", mood: "Bright, open, endless sky.", use: 5, cap: "And then — everything opens up.", in: 20, out: 25.5 },
  { name: "descent_golden.mp4", dur: 55, a: "#ffd98a", b: "#c85c1a", subj: "Silhouetted hikers descend a ridge in warm low sun.", mood: "Golden backlight, long shadows.", use: 4, cap: "Down through the golden hour.", in: 10, out: 14.6 },
];

let seeded = false;
export function seedProject(dispatch: Dispatch<Action>) {
  if (seeded) return; // StrictMode fires effects twice in dev — seed only once.
  seeded = true;
  const clips: Clip[] = S.map((s, i) => ({
    id: `c${i}`, file: file(s.name), name: s.name, durationSec: s.dur, width: 1920, height: 1080,
    poster: poster(s.a, s.b),
    description: { subjectAction: s.subj, settingMood: s.mood, usability: s.use, model: "claude-haiku-4-5", raw: "" },
  }));
  // A 7th, unused clip.
  clips.push({
    id: "c6", file: file("camp_night.mov"), name: "camp_night.mov", durationSec: 70, width: 1920, height: 1080,
    poster: poster("#4a4e9e", "#0e0630"),
    description: { subjectAction: "A dim campsite at night, hard to make out.", settingMood: "Dark, flat, low light.", usability: 2, model: "claude-haiku-4-5", raw: "" },
  });

  const story: Story = {
    logline: "A weekend in the Dolomites, from first light to the summit.",
    beats: S.map((s, i) => ({ clipId: `c${i}`, scriptText: s.cap })),
  };
  const cut: Cut = {
    aspect: "16:9",
    beats: S.map((s, i) => ({ id: `b${i}`, clipId: `c${i}`, inSec: s.in, outSec: s.out, durationSec: s.out - s.in, scriptText: s.cap, captionText: s.cap })),
  };

  dispatch({ type: "ADD_CLIPS", clips });
  dispatch({ type: "SET_DIRECTION", direction: "quiet, earned, no hype" });
  dispatch({ type: "SET_STORY", story });
  dispatch({ type: "SET_CUT", cut });
}
