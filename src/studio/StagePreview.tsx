import { useEffect, useRef, useState } from "react";
import type { Beat, Clip, Cut } from "../domain/types";
import FinalPreview from "../features/export/FinalPreview";
import { captionSchedule, cueAt } from "../lib/pacing";
import { fmtClock } from "./util";

interface Props {
  cut: Cut;
  clips: Clip[];
  beat: Beat | null;
  clip: Clip | undefined;
}

/**
 * Two views of the same Cut:
 *  - "Beat": the selected Beat's trimmed window, scrubbable, caption burned in.
 *  - "Cut": the whole edit played back sequentially (reuses the export FinalPreview).
 */
export default function StagePreview({ cut, clips, beat, clip }: Props) {
  const [mode, setMode] = useState<"beat" | "cut">("beat");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 0..1 within the beat window

  // Load the selected clip's source; object URL lifetime matches the <video> src.
  useEffect(() => {
    if (mode !== "beat") return;
    const v = videoRef.current;
    if (!v || !clip || !beat) return;
    const url = URL.createObjectURL(clip.normalized ?? clip.file);
    v.src = url;
    setPos(0);
    setPlaying(false);
    const onMeta = () => { v.currentTime = beat.inSec; };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => { v.removeEventListener("loadedmetadata", onMeta); URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, beat?.id, mode]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v || !beat) return;
    if (playing) { v.pause(); setPlaying(false); return; }
    if (v.currentTime < beat.inSec || v.currentTime >= beat.outSec) v.currentTime = beat.inSec;
    v.play().then(() => setPlaying(true)).catch(() => {});
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !beat) return;
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    setPos(Math.min(1, Math.max(0, (v.currentTime - beat.inSec) / span)));
    if (playing && v.currentTime >= beat.outSec) {
      v.pause();
      v.currentTime = beat.outSec;
      setPlaying(false);
    }
  }

  if (mode === "cut") {
    return (
      <>
        <div style={{ borderRadius: 12, overflow: "hidden" }}>
          <FinalPreview
            cut={cut}
            clips={clips}
            captionScale={1}
            captionOpacity={0.5}
            captionLineHeight={1.6}
            title={null}
            music={null}
            musicVolume={0.5}
            voiceover={false}
          />
        </div>
        <div className="st-transport">
          <span className="st-tc">Playing the whole cut</span>
          <span className="st-spacer" />
          <ModeSwitch mode={mode} setMode={setMode} />
        </div>
      </>
    );
  }

  if (!beat) {
    return (
      <div className="st-stage-empty">
        <h2>No cut yet</h2>
        <p>Add clips on the left, then press <strong>Regenerate cut</strong> to let Claude build a first draft.</p>
      </div>
    );
  }

  const aspectRatio = cut.aspect === "9:16" ? "9 / 16" : cut.aspect === "1:1" ? "1 / 1" : "16 / 9";

  // Timed beats show one line at a time as you scrub; untimed beats show the
  // whole stacked caption. beatElapsed = seconds into the trimmed window.
  const schedule = captionSchedule(beat.captionText, beat.captionDurations);
  const beatElapsed = pos * (beat.outSec - beat.inSec);
  const caption = schedule ? cueAt(schedule, beatElapsed)?.text ?? "" : beat.captionText;

  return (
    <>
      <div className="st-preview" style={{ aspectRatio }}>
        <video ref={videoRef} onTimeUpdate={onTimeUpdate} muted playsInline />
        <div className="st-badgeTL st-num">Beat {String(cut.beats.indexOf(beat) + 1).padStart(2, "0")} · {clip?.name ?? "—"}</div>
        <div className="cap"><span>{caption}</span></div>
      </div>
      <div className="st-transport">
        <button className="st-play" onClick={togglePlay} title={playing ? "Pause" : "Play beat"}>
          {playing
            ? <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor"><rect x="1" width="3.4" height="13" rx="1"/><rect x="7.6" width="3.4" height="13" rx="1"/></svg>
            : <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor"><path d="M0 0l12 6.5L0 13z"/></svg>}
        </button>
        <span className="st-tc st-num">{fmtClock(beat.inSec + pos * (beat.outSec - beat.inSec))}</span>
        <div className="st-scrub"><div className="fill" style={{ width: `${pos * 100}%` }} /></div>
        <span className="st-tc st-num">{fmtClock(beat.outSec)}</span>
        <span className="st-tsep" />
        <ModeSwitch mode={mode} setMode={setMode} />
      </div>
    </>
  );
}

function ModeSwitch({ mode, setMode }: { mode: "beat" | "cut"; setMode: (m: "beat" | "cut") => void }) {
  return (
    <div className="st-modeswitch">
      <button className={mode === "beat" ? "on" : ""} onClick={() => setMode("beat")}>Beat</button>
      <button className={mode === "cut" ? "on" : ""} onClick={() => setMode("cut")}>Cut</button>
    </div>
  );
}
