import { useCallback, useRef, useState } from "react";
import type { VoSegment } from "../domain/types";
import { fitVoSegmentToVoice } from "../features/refine/fitVoLength";
import { useProject } from "../state/ProjectContext";
import { useExportSettings } from "../state/ExportSettingsContext";
import { synthesizeVoiceover } from "../lib/tts";

export interface VoFitController {
  /** Fit a segment's length to its spoken duration. No-ops while a fit is in flight. */
  fitVo: (segment: VoSegment) => Promise<void>;
  fitting: boolean;
  error: string | null;
}

/**
 * Owns the "fit length to voice" run for the whole editor. StudioApp holds the single
 * instance and hands it to the Inspector, so the button and the timeline's `f`
 * shortcut share one in-flight state — the button reads "Fitting…" either way, and
 * neither entry point can start a second synthesis on top of the first.
 */
export function useVoFit(): VoFitController {
  const { dispatch } = useProject();
  const { settings: es } = useExportSettings();
  const [fitting, setFitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the state: a held `f` fires repeats faster than React re-renders.
  const inFlight = useRef(false);

  const fitVo = useCallback(
    async (segment: VoSegment) => {
      if (inFlight.current) return;
      if (!segment.text.trim()) return;

      inFlight.current = true;
      setFitting(true);
      setError(null);
      try {
        const result = await fitVoSegmentToVoice(segment, (text) =>
          synthesizeVoiceover(text, {
            engine: es.ttsEngine,
            voice: es.voice,
            elevenVoiceId: es.elevenVoiceId,
            speed: es.voiceoverSpeed,
            elevenModel: es.elevenModel,
            elevenStability: es.elevenStability,
            elevenStyle: es.elevenStyle,
          })
        );
        if (!result) return;
        if (result.ok) dispatch({ type: "UPDATE_VO", segment: result.segment });
        else setError(result.error);
      } finally {
        inFlight.current = false;
        setFitting(false);
      }
    },
    [
      dispatch,
      es.ttsEngine,
      es.voice,
      es.elevenVoiceId,
      es.voiceoverSpeed,
      es.elevenModel,
      es.elevenStability,
      es.elevenStyle,
    ]
  );

  return { fitVo, fitting, error };
}
