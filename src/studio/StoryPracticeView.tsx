import { useMemo, useState } from "react";
import {
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  type AiProvider,
} from "../state/SettingsContext";
import {
  emptyPracticeStory,
  loadPracticeSession,
  practiceStoryWordCount,
  reviewPracticeStory,
  savePracticeSession,
  STORY_STEPS,
  type CoachReview,
  type PracticeStory,
  type StoryCoach,
  type StoryStepId,
} from "../features/story-practice/storyCoach";
import Button from "../design-system/Button";
import Badge from "../design-system/Badge";
import { InputControl, SelectControl, TextareaControl } from "../design-system/ControlPrimitives";
import { randomStoryExample } from "../features/story-practice/storyExamples";
import { useUserVoiceRecorder } from "./useUserVoiceRecorder";
import { deliveryMetrics } from "./userVoiceTranscript";
import { getClipBlobUrl } from "../lib/blobUrlCache";

const PLATFORM_OPTIONS: PracticeStory["platform"][] = ["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "Other"];

function modelLabel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-/g, " ");
}

function scoreTone(score: number): "neutral" | "signal" | "positive" {
  if (score >= 80) return "positive";
  if (score >= 55) return "signal";
  return "neutral";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Publish-ready";
  if (score >= 80) return "Strong foundation";
  if (score >= 65) return "Promising";
  if (score >= 45) return "Developing";
  return "Early practice";
}

export default function StoryPracticeView({ coach }: { coach?: StoryCoach }) {
  const initial = useMemo(loadPracticeSession, []);
  const [story, setStory] = useState(initial.story);
  const [review, setReview] = useState<CoachReview | null>(initial.review);
  const [provider, setProvider] = useState<AiProvider>("claude");
  const [model, setModel] = useState<string>(MODEL_OPTIONS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [example, setExample] = useState(() => randomStoryExample());
  const [spokenFile, setSpokenFile] = useState<File | null>(null);
  const [spokenDuration, setSpokenDuration] = useState(0);
  const [spokenTranscript, setSpokenTranscript] = useState("");
  const recorder = useUserVoiceRecorder(({ file, durationSec, transcript }) => {
    setSpokenFile(file);
    setSpokenDuration(durationSec);
    setSpokenTranscript(transcript);
  });
  const wordCount = practiceStoryWordCount(story);
  const availableModels = provider === "codex" ? CODEX_MODEL_OPTIONS : MODEL_OPTIONS;

  function commit(nextStory: PracticeStory, nextReview: CoachReview | null = review) {
    setStory(nextStory);
    setReview(nextReview);
    savePracticeSession(nextStory, nextReview);
  }

  function updateMeta(patch: Partial<Pick<PracticeStory, "platform" | "audience" | "objective">>) {
    commit({ ...story, ...patch }, null);
  }

  function updateStep(step: StoryStepId, value: string) {
    commit({ ...story, steps: { ...story.steps, [step]: value } }, null);
  }

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const config = {
        provider,
        ...(provider === "codex" ? { codexModel: model } : { model }),
      };
      const nextReview = coach
        ? await reviewPracticeStory(story, config, coach, spokenTranscript.trim() ? { transcript: spokenTranscript, durationSec: spokenDuration, ...deliveryMetrics(spokenTranscript, spokenDuration) } : undefined)
        : await reviewPracticeStory(story, config, undefined, spokenTranscript.trim() ? { transcript: spokenTranscript, durationSec: spokenDuration, ...deliveryMetrics(spokenTranscript, spokenDuration) } : undefined);
      setReview(nextReview);
      savePracticeSession(story, nextReview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function startFresh() {
    if (wordCount > 0 && !confirm("Start a fresh practice story? This clears the current draft and Coach review.")) return;
    const next = emptyPracticeStory();
    setError("");
    commit(next, null);
  }

  function useExample() {
    if (wordCount > 0 && !confirm("Replace your current practice draft with this example?")) return;
    setError("");
    commit(example.story, null);
  }

  return (
    <div className="st-story-practice">
      <section className="st-story-practice-hero">
        <Badge tone="signal">Social storytelling coach</Badge>
        <h3>Practice the story before you perform it.</h3>
        <p>Build a clear arc, find the moments that hold attention, and strengthen your own voice through focused feedback—not a generic AI rewrite.</p>
      </section>

      <details className="st-story-example">
        <summary>
          <span><strong>See a complete example</strong><small>A random story showing all six structural steps</small></span>
          <span className="st-story-example-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="st-story-example-body">
          <header>
            <div><Badge tone="neutral">Example</Badge><strong>{example.title}</strong></div>
            <Button
              variant="quiet"
              size="small"
              onClick={() => setExample(randomStoryExample(example.id))}
              title="Generate a different random example"
            >
              Regenerate example
            </Button>
          </header>
          <div className="st-story-example-meta">For {example.story.audience} · {example.story.platform}</div>
          <div className="st-story-example-steps">
            {STORY_STEPS.map((step) => (
              <div key={step.id}><strong>{step.label}</strong><p>{example.story.steps[step.id]}</p></div>
            ))}
          </div>
          <Button variant="secondary" size="small" onClick={useExample}>Use this example</Button>
        </div>
      </details>

      <section className="st-story-practice-section">
        <header><div><strong>Practice setup</strong><span>Give the Coach enough context to judge relevance.</span></div></header>
        <div className="st-story-practice-grid">
          <label>
            <span>Platform</span>
            <SelectControl value={story.platform} onChange={(event) => updateMeta({ platform: event.target.value as PracticeStory["platform"] })}>
              {PLATFORM_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </SelectControl>
          </label>
          <label>
            <span>Audience</span>
            <InputControl value={story.audience} onChange={(event) => updateMeta({ audience: event.target.value })} placeholder="Who should care?" />
          </label>
        </div>
        <label>
          <span>What should the audience feel, learn, or do?</span>
          <InputControl value={story.objective} onChange={(event) => updateMeta({ objective: event.target.value })} placeholder="Example: feel confident posting their first video" />
        </label>
      </section>

      <section className="st-story-practice-section">
        <header>
          <div><strong>Story structure</strong><span>Problem + Journey + Resolution form the middle.</span></div>
          <Badge>{wordCount} words</Badge>
        </header>
        <div className="st-story-step-list">
          {STORY_STEPS.map((step, index) => (
            <label className="st-story-step-editor" key={step.id}>
              <span className="st-story-step-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="st-story-step-copy"><strong>{step.label}</strong><small>{step.prompt}</small></span>
              <TextareaControl
                value={story.steps[step.id]}
                onChange={(event) => updateStep(step.id, event.target.value)}
                placeholder={`Write your ${step.label.toLowerCase()}…`}
                rows={3}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="st-story-practice-section st-story-coach-controls">
        <header><div><strong>Your Coach</strong><span>Choose the local AI engine and model used for this review.</span></div></header>
        <div className="st-story-practice-grid">
          <label>
            <span>AI engine</span>
            <SelectControl
              value={provider}
              onChange={(event) => {
                const next = event.target.value as AiProvider;
                setProvider(next);
                setModel(next === "codex" ? CODEX_MODEL_OPTIONS[0] : MODEL_OPTIONS[1]);
              }}
              disabled={busy}
            >
              <option value="claude">Claude Code CLI</option>
              <option value="codex">Codex CLI</option>
            </SelectControl>
          </label>
          <label>
            <span>Model</span>
            <SelectControl value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
              {availableModels.map((option) => <option key={option} value={option}>{modelLabel(option)}</option>)}
            </SelectControl>
          </label>
        </div>
        {error && <div className="st-product-review-alert" role="alert">{error}</div>}
        <div className="st-story-practice-actions">
          <Button variant="secondary" size="small" onClick={startFresh} disabled={busy}>Start fresh</Button>
          <Button variant="primary" onClick={() => { void analyze(); }} disabled={busy || wordCount < 20}>
            {busy ? "Coach is reviewing…" : review ? "Analyze again" : "Analyze my story"}
          </Button>
        </div>
        {wordCount < 20 && <small className="st-story-practice-hint">Write at least 20 words to receive useful coaching.</small>}
      </section>

      <section className="st-story-practice-section st-story-spoken-practice">
        <header><div><strong>Practice out loud</strong><span>Record a delivery sample for pace, filler-word, and spoken-rhythm coaching.</span></div></header>
        <div className="st-story-spoken-actions">
          {recorder.status === "recording" || recorder.status === "stopping" ? (
            <Button variant="danger" onClick={recorder.stop} disabled={recorder.status === "stopping"}>{recorder.status === "stopping" ? "Saving take…" : `Stop · ${Math.round(recorder.elapsedSec)}s`}</Button>
          ) : (
            <Button variant="secondary" onClick={() => { void recorder.start(); }}>Record practice take</Button>
          )}
          {!recorder.transcriptionAvailable && <small>Live transcription is unavailable in this browser; you can paste the transcript below.</small>}
        </div>
        {(recorder.liveTranscript || spokenTranscript || spokenFile) && (
          <>
            {spokenFile && <audio controls src={getClipBlobUrl(spokenFile) ?? undefined} />}
            <TextareaControl
              value={recorder.status === "recording" ? recorder.liveTranscript : spokenTranscript}
              onChange={(event) => setSpokenTranscript(event.target.value)}
              readOnly={recorder.status === "recording"}
              rows={4}
              aria-label="Spoken practice transcript"
              placeholder="Your spoken transcript will appear here."
            />
            {spokenTranscript && (() => {
              const metrics = deliveryMetrics(spokenTranscript, spokenDuration);
              return <div className="st-story-delivery-metrics"><Badge>{metrics.wordsPerMinute} WPM</Badge><Badge>{metrics.wordCount} words</Badge><Badge tone={metrics.fillerCount > 3 ? "signal" : "positive"}>{metrics.fillerCount} fillers</Badge></div>;
            })()}
            {spokenTranscript && <Button variant="primary" onClick={() => { void analyze(); }} disabled={busy || wordCount < 20}>{busy ? "Coach is reviewing…" : "Analyze story + delivery"}</Button>}
          </>
        )}
        {recorder.error && <div className="st-product-review-alert" role="alert">{recorder.error}</div>}
      </section>

      {review && (
        <section className="st-story-review" aria-label="Coach Review">
          <div className="st-story-score-card">
            <div className="st-story-score-ring"><strong>{review.overallScore}</strong><span>/ 100</span></div>
            <div><Badge tone={scoreTone(review.overallScore)}>{scoreLabel(review.overallScore)}</Badge><h3>Coach Review</h3><p>{review.confidenceMessage}</p></div>
          </div>

          <div className="st-story-review-summary">
            <p>{review.summary}</p>
            <div><strong>Strongest moment</strong><span>{review.strongestMoment}</span></div>
            <div className="priority"><strong>Highest-leverage improvement</strong><span>{review.highestLeverageImprovement}</span></div>
            <div><strong>Engagement forecast</strong><span>{review.engagementForecast}</span></div>
          </div>

          <div className="st-story-review-steps">
            {review.stepFeedback.map((feedback) => {
              const definition = STORY_STEPS.find((step) => step.id === feedback.step)!;
              return (
                <article key={feedback.step} className="st-story-feedback-card">
                  <header><strong>{definition.label}</strong><Badge tone={scoreTone(feedback.score)}>{feedback.score}</Badge></header>
                  <div><b>Working</b><p>{feedback.working || "The Coach did not identify a strong signal yet."}</p></div>
                  <div><b>Improve</b><p>{feedback.improve || "Add more specific detail and consequence."}</p></div>
                  <div><b>Try next</b><p>{feedback.suggestion}</p></div>
                  {feedback.exampleRewrite && (
                    <blockquote><span>Example—not a replacement</span>{feedback.exampleRewrite}</blockquote>
                  )}
                </article>
              );
            })}
          </div>

          <div className="st-story-practice-section">
            <header><div><strong>Delivery coaching</strong><span>How to make the written story feel alive when spoken.</span></div></header>
            <ol className="st-story-coach-list">{review.deliveryTips.map((tip, index) => <li key={`${tip}-${index}`}>{tip}</li>)}</ol>
          </div>
          <div className="st-story-practice-challenge"><Badge tone="signal">Next rep</Badge><strong>{review.practiceChallenge}</strong></div>
        </section>
      )}
    </div>
  );
}
