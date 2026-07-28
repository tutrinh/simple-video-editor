import { useState } from "react";
import PlayIcon from "./icons/PlayIcon";
import PauseIcon from "./icons/PauseIcon";

interface PlayButtonProps {
  playing?: boolean;
  defaultPlaying?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  label?: string;
}

export default function PlayButton({
  playing,
  defaultPlaying = false,
  onPlayingChange,
  label = "preview",
}: PlayButtonProps) {
  const [internalPlaying, setInternalPlaying] = useState(defaultPlaying);
  const isPlaying = playing ?? internalPlaying;

  function toggle() {
    const next = !isPlaying;
    if (playing === undefined) setInternalPlaying(next);
    onPlayingChange?.(next);
  }

  return (
    <button
      type="button"
      className="ds-play"
      aria-label={`${isPlaying ? "Pause" : "Play"} ${label}`}
      aria-pressed={isPlaying}
      onClick={toggle}
    >
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
