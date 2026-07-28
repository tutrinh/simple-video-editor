import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../state/ThemeContext";
import Switch from "./Switch";
import ClipSwapModal, { type ClipSwapItem } from "./ClipSwapModal";
import PlayButton from "./PlayButton";
import Scrubber from "./Scrubber";
import Button from "./Button";
import { SelectField, TextareaField, TextField } from "./Field";
import RangeField from "./RangeField";
import SegmentedControl from "./SegmentedControl";
import { EmptyState, ProgressNotice } from "./Feedback";
import CopyIcon from "./icons/CopyIcon";
import CloseIcon from "./icons/CloseIcon";
import CheckIcon from "./icons/CheckIcon";
import FavoriteIcon from "./icons/FavoriteIcon";
import SearchIcon from "./icons/SearchIcon";
import UndoIcon from "./icons/UndoIcon";
import DeleteIcon from "./icons/DeleteIcon";
import LockIcon from "./icons/LockIcon";
import UnlockIcon from "./icons/UnlockIcon";
import ChevronDownIcon from "./icons/ChevronDownIcon";
import ChevronUpIcon from "./icons/ChevronUpIcon";
import AddIcon from "./icons/AddIcon";
import SaveIcon from "./icons/SaveIcon";
import DownloadIcon from "./icons/DownloadIcon";
import MenuIcon from "./icons/MenuIcon";
import SwitchIcon from "./icons/SwitchIcon";
import ChevronLeftIcon from "./icons/ChevronLeftIcon";
import ChevronRightIcon from "./icons/ChevronRightIcon";
import ComponentInventoryShowcase from "./ComponentInventoryShowcase";
import "./design-system.css";

const sections = [
  ["foundations", "Foundations"],
  ["typography", "Typography"],
  ["icons", "SVG icons"],
  ["actions", "Actions"],
  ["forms", "Form elements"],
  ["feedback", "Feedback"],
  ["patterns", "Reusable patterns"],
  ["editor", "Editor patterns"],
] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="ds-section" id={id}>
      <div className="ds-section-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function Specimen({
  title,
  meta,
  children,
  className = "",
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`ds-specimen ${className}`}>
      <header>
        <h3>{title}</h3>
        {meta && <code>{meta}</code>}
      </header>
      <div className="ds-specimen-body">{children}</div>
    </article>
  );
}

const colorTokens = [
  ["Canvas", "--ds-canvas", "Page background"],
  ["Surface", "--ds-surface", "Primary panels"],
  ["Ink", "--ds-ink", "Primary content"],
  ["Signal", "--ds-signal", "Actions and focus"],
  ["Positive", "--ds-positive", "Success state"],
  ["Critical", "--ds-critical", "Errors and danger"],
] as const;

const TRANSPORT_DURATION = 18;
const swapClips: ClipSwapItem[] = [
  { id: "rack", name: "Clothes Rack", duration: "6.4s", tone: "warm" },
  { id: "display", name: "Display", duration: "6.6s", tone: "signal" },
  { id: "overlay", name: "Overlays Vertical", duration: "0.4s", tone: "dark" },
  { id: "vases", name: "Vases", duration: "11.5s", tone: "positive" },
  { id: "figures", name: "Three Stooges", duration: "5.9s", tone: "neutral" },
];

function formatTransportTime(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  const tenths = Math.floor((seconds - wholeSeconds) * 10);
  return `00:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
}

function ThemeIcon({ theme }: { theme: "light" | "dark" }) {
  return <span className="ds-theme-icon" aria-hidden="true">{theme === "light" ? "☼" : "◐"}</span>;
}

export default function DesignSystemPage() {
  const { theme, toggleTheme } = useTheme();
  const [enabled, setEnabled] = useState(true);
  const [range, setRange] = useState(64);
  const [segment, setSegment] = useState("Edit");
  const [showDialog, setShowDialog] = useState(false);
  const [transportPlaying, setTransportPlaying] = useState(false);
  const [transportTime, setTransportTime] = useState(0);
  const [swapOpen, setSwapOpen] = useState(false);
  const [selectedSwapClip, setSelectedSwapClip] = useState("rack");

  useEffect(() => {
    if (!showDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowDialog(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showDialog]);

  useEffect(() => {
    if (!transportPlaying) return;
    const interval = window.setInterval(() => {
      setTransportTime((current) => Math.min(TRANSPORT_DURATION, current + 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [transportPlaying]);

  useEffect(() => {
    if (transportTime < TRANSPORT_DURATION) return;
    setTransportPlaying(false);
    setTransportTime(0);
  }, [transportTime]);

  return (
    <div className="ds-page">
      <header className="ds-topbar">
        <a className="ds-mark" href="/design-system" aria-label="Cutroom design system home">
          <span className="ds-mark-symbol" aria-hidden="true"><i /><i /><i /></span>
          <span>Cutroom <b>System</b></span>
        </a>
        <nav aria-label="Design system navigation">
          <a href="#foundations">Foundations</a>
          <a href="#forms">Controls</a>
          <a href="#editor">Patterns</a>
        </nav>
        <div className="ds-top-actions">
          <button className="ds-icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            <ThemeIcon theme={theme} />
          </button>
          <a className="ds-button ds-button-ink ds-button-small" href="/">Open editor <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <div className="ds-shell">
        <aside className="ds-sidebar">
          <div className="ds-sidebar-label">Contents</div>
          <nav aria-label="On this page">
            {sections.map(([href, label], index) => (
              <a href={`#${href}`} key={href} className={index === 0 ? "active" : ""}>
                <span>{String(index + 1).padStart(2, "0")}</span>{label}
              </a>
            ))}
          </nav>
          <div className="ds-sidebar-note">
            <span>Principle</span>
            <p>Let the work carry the color. Interface chrome stays calm and exact.</p>
          </div>
        </aside>

        <main className="ds-content">
          <section className="ds-hero">
            <div className="ds-kicker">React component inventory</div>
            <h1>One visual language for every cut.</h1>
            <p>A practical system for building focused editing tools with warm surfaces, hard contrast, and precise blue signals.</p>
            <div className="ds-hero-meta">
              <div><span>Coverage</span><strong>End to end</strong></div>
              <div><span>Foundation</span><strong>Semantic tokens</strong></div>
              <div><span>Modes</span><strong>Light + dark</strong></div>
            </div>
          </section>

          <Section id="foundations" title="Foundations" description="A cream canvas lowers visual noise. Ink establishes structure. Electric blue is reserved for intent.">
            <div className="ds-color-grid">
              {colorTokens.map(([name, token, use]) => (
                <div className="ds-color" key={token}>
                  <div className="ds-swatch" style={{ background: `var(${token})` }} />
                  <strong>{name}</strong>
                  <code>{token}</code>
                  <span>{use}</span>
                </div>
              ))}
            </div>
            <div className="ds-foundation-row">
              <Specimen title="Spacing" meta="4px base unit" className="ds-span-2">
                <div className="ds-spacing-scale">
                  {[4, 8, 12, 16, 24, 32, 48].map((space) => (
                    <div key={space}><i style={{ width: space }} /><span>{space}</span></div>
                  ))}
                </div>
              </Specimen>
              <Specimen title="Shape" meta="4 / 8 / 12 / pill">
                <div className="ds-radius-scale"><i /><i /><i /><i /></div>
              </Specimen>
            </div>
          </Section>

          <Section id="typography" title="Typography" description="A compact sans family for product hierarchy, paired with mono for time, values, and technical context.">
            <div className="ds-type-specimen">
              <div className="ds-type-display"><span>Display 56 / 0.96</span><strong>Shape the story.</strong></div>
              <div className="ds-type-title"><span>Title 32 / 1.05</span><strong>Sequence and pacing</strong></div>
              <div className="ds-type-heading"><span>Heading 18 / 1.25</span><strong>Export settings</strong></div>
              <div className="ds-type-body"><span>Body 14 / 1.5</span><p>Controls should read quickly and disappear when attention returns to the footage.</p></div>
              <div className="ds-type-label"><span>Label 11 / 1.2</span><strong>Audio level</strong></div>
              <div className="ds-type-mono"><span>Mono 12 / tabular</span><code>00:14:22.08</code></div>
            </div>
          </Section>

          <Section id="icons" title="SVG icons" description="Product icons use currentColor, a shared 24px view box, and size through the component interface.">
            <div className="ds-icon-grid">
              <Specimen title="Copy" meta="overlapping documents">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <CopyIcon />
                  </div>
                  <div>
                    <strong>CopyIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>Defaults to 46px and inherits the surrounding text color.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Close" meta="dismiss / remove">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <CloseIcon />
                  </div>
                  <div>
                    <strong>CloseIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>Used by the shared CloseButton across drawers, dialogs, and picker surfaces.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Check" meta="confirm / complete">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <CheckIcon />
                  </div>
                  <div>
                    <strong>CheckIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For confirmation, completed states, and selected options.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Favorite" meta="save / favorite">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <FavoriteIcon />
                  </div>
                  <div>
                    <strong>FavoriteIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For favoriting, saving, and highlighting preferred items.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Search" meta="find / filter">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <SearchIcon />
                  </div>
                  <div>
                    <strong>SearchIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For search inputs, finding assets, and filtering collections.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Undo" meta="history / reverse">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <UndoIcon />
                  </div>
                  <div>
                    <strong>UndoIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For reversing the latest edit or returning to the previous state.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Delete" meta="remove / destructive">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <DeleteIcon />
                  </div>
                  <div>
                    <strong>DeleteIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For destructive removal actions, paired with the critical color when appropriate.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Lock" meta="secure / fixed">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <LockIcon />
                  </div>
                  <div>
                    <strong>LockIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For protected content, fixed tracks, and controls that cannot be edited.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Unlock" meta="editable / released">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <UnlockIcon />
                  </div>
                  <div>
                    <strong>UnlockIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For editable content, released tracks, and removing protected states.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Chevron down" meta="dropdown / disclose">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <ChevronDownIcon />
                  </div>
                  <div>
                    <strong>ChevronDownIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For dropdown controls, expandable sections, and downward navigation.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Chevron up" meta="collapse / upward">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <ChevronUpIcon />
                  </div>
                  <div>
                    <strong>ChevronUpIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For collapsing sections, upward navigation, and expanded dropdown states.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Add" meta="create / insert">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <AddIcon />
                  </div>
                  <div>
                    <strong>AddIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For creating items, inserting clips, and adding content to a collection.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Save" meta="persist / store">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <SaveIcon />
                  </div>
                  <div>
                    <strong>SaveIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For saving projects, persisting edits, and storing the current state.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Download" meta="export / retrieve">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <DownloadIcon />
                  </div>
                  <div>
                    <strong>DownloadIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For downloading exports, retrieving assets, and saving files locally.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Menu" meta="navigation / options">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <MenuIcon />
                  </div>
                  <div>
                    <strong>MenuIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For opening navigation, compact menus, and additional option panels.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Switch" meta="swap / exchange">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <SwitchIcon />
                  </div>
                  <div>
                    <strong>SwitchIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For swapping clips, exchanging items, and changing between sources.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Chevron left" meta="back / previous">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <ChevronLeftIcon />
                  </div>
                  <div>
                    <strong>ChevronLeftIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For previous steps, backward navigation, and moving left through content.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Chevron right" meta="next / forward">
                <div className="ds-icon-showcase">
                  <div className="ds-icon-hero">
                    <ChevronRightIcon />
                  </div>
                  <div>
                    <strong>ChevronRightIcon</strong>
                    <code>24 × 24 viewBox</code>
                    <span>For next steps, forward navigation, and moving right through content.</span>
                  </div>
                </div>
              </Specimen>
              <Specimen title="Sizing" meta="16 / 20 / 24 / 46" className="ds-span-2">
                <div className="ds-icon-sizes">
                  {[16, 20, 24, 46].map((size) => (
                    <div key={size}>
                      <CopyIcon size={size} />
                      <code>{size}</code>
                    </div>
                  ))}
                </div>
              </Specimen>
              <Specimen title="Button usage" meta="icon / icon + label" className="ds-span-2">
                <div className="ds-inline-wrap">
                  <button className="ds-svg-button" type="button" aria-label="Copy">
                    <CopyIcon size={18} />
                  </button>
                  <Button icon={<CopyIcon size={16} />}>Copy link</Button>
                </div>
              </Specimen>
            </div>
          </Section>

          <Section id="actions" title="Actions and navigation" description="Buttons communicate priority without decoration. Tabs and segments stay close to the content they control.">
            <div className="ds-two-col">
              <Specimen title="Buttons" meta="default / hover / disabled">
                <div className="ds-inline-wrap">
                  <Button variant="primary">Export video</Button>
                  <Button variant="secondary">Cancel</Button>
                  <Button variant="quiet">Duplicate</Button>
                  <Button variant="danger">Remove</Button>
                  <Button disabled>Unavailable</Button>
                </div>
              </Specimen>
              <Specimen title="Segments" meta="single selection">
                <SegmentedControl
                  value={segment}
                  options={["Edit", "Color", "Audio"].map((item) => ({ value: item, label: item }))}
                  onChange={setSegment}
                  ariaLabel="Workspace mode"
                />
                <div className="ds-tabs" role="tablist" aria-label="Inspector panels">
                  <button className="active" role="tab">Clip</button>
                  <button role="tab">Captions</button>
                  <button role="tab">Effects</button>
                </div>
              </Specimen>
              <Specimen title="Content cards" meta="query / editorial" className="ds-span-2">
                <div className="ds-card-variations">
                  <div className="ds-query-card">
                    <code>$graphify query "who owns billing?"</code>
                    <div>
                      <span aria-hidden="true">→</span>
                      <strong>1 path</strong>
                      <strong>2 hops</strong>
                      <em>EXTRACTED</em>
                    </div>
                  </div>
                  <article className="ds-article-card">
                    <div className="ds-article-card-meta">
                      <span>Level Up Coding (Medium)</span>
                      <span className="ds-tag">TUTORIAL</span>
                    </div>
                    <h4>Turn Any Codebase Into a Knowledge Graph with Graphify <span aria-hidden="true">↗</span></h4>
                    <p>Prem Chandak <i aria-hidden="true">·</i> May 2026</p>
                  </article>
                </div>
              </Specimen>
            </div>
          </Section>

          <Section id="forms" title="Form elements" description="Labels stay visible. Focus is blue. Supporting text explains format or recovery without competing with the field.">
            <div className="ds-form-grid">
              <Specimen title="Text fields" meta="input / select / textarea" className="ds-span-2">
                <div className="ds-fields">
                  <TextField label="Project name" defaultValue="West coast cut" help="Shown in exports and recent projects." />
                  <SelectField label="Aspect ratio" defaultValue="16:9" help="Match the primary publishing destination.">
                      <option>16:9</option><option>9:16</option><option>1:1</option>
                  </SelectField>
                  <div className="ds-field-wide">
                    <TextareaField
                      label="Creative direction"
                      defaultValue="Tighten the opening and hold longer on the final reaction."
                      help="Use direct editorial notes and concrete timing cues."
                    />
                  </div>
                </div>
              </Specimen>
              <Specimen title="Selection" meta="radio / checkbox / switch">
                <div className="ds-choice-list">
                  <label><input type="radio" name="quality" defaultChecked /><span><b>High quality</b><small>Best for the final export</small></span></label>
                  <label><input type="radio" name="quality" /><span><b>Fast preview</b><small>Optimized for review</small></span></label>
                  <label><input type="checkbox" defaultChecked /><span><b>Burn in captions</b><small>Include active caption styling</small></span></label>
                  <div className="ds-switch-row"><span><b>Normalize audio</b><small>Balance perceived loudness</small></span><Switch checked={enabled} onChange={setEnabled} label="Normalize audio" /></div>
                </div>
              </Specimen>
              <Specimen title="Range control" meta="name / slider / value">
                <RangeField label="Intensity" min={0} max={100} value={range} onChange={setRange} />
              </Specimen>
            </div>
          </Section>

          <Section id="feedback" title="Status and feedback" description="Feedback stays contextual. Color supports a plain-language message and never carries meaning alone.">
            <div className="ds-feedback-grid">
              <Specimen title="Badges" meta="status / category">
                <div className="ds-inline-wrap">
                  <span className="ds-badge">Draft</span>
                  <span className="ds-badge ds-badge-signal">Selected</span>
                  <span className="ds-badge ds-badge-positive">Ready</span>
                  <span className="ds-badge ds-badge-critical">Failed</span>
                </div>
              </Specimen>
              <Specimen title="Technical tags" meta="provenance / confidence">
                <div className="ds-inline-wrap">
                  <span className="ds-tag ds-tag-positive">[EXTRACTED]</span>
                  <span className="ds-tag ds-tag-signal">[INFERRED]</span>
                  <span className="ds-tag">[AMBIGUOUS]</span>
                </div>
              </Specimen>
              <Specimen title="Inline messages" meta="info / success / error">
                <div className="ds-alert ds-alert-info"><b>Export in progress</b><span>You can keep editing while the preview renders.</span></div>
                <div className="ds-alert ds-alert-positive"><b>Project saved</b><span>All media references are available.</span></div>
                <div className="ds-alert ds-alert-critical"><b>Clip unavailable</b><span>Reconnect the source file to continue.</span></div>
              </Specimen>
              <Specimen title="System states" meta="loading / empty" className="ds-span-2">
                <div className="ds-states">
                  <ProgressNotice title="Building preview" message="Rendering the current timeline selection." />
                  <EmptyState title="No clips in this cut" description="Add media from the clip bin to begin." action={{ label: "Add clip", onClick: () => {} }} />
                </div>
              </Specimen>
            </div>
          </Section>

          <Section id="patterns" title="Reusable patterns" description="Shared structures for media libraries, inspector controls, menus, notifications, and timeline composition.">
            <ComponentInventoryShowcase />
          </Section>

          <Section id="editor" title="Editor patterns" description="Domain components carry more information, but they use the same hierarchy, states, and interaction rules as the core system.">
            <div className="ds-editor-grid">
              <Specimen title="Video scrubber" meta="transport / in / out" className="ds-span-2">
                <Scrubber
                  duration={18}
                  initialIn={2}
                  initialOut={16}
                />
              </Specimen>
              <Specimen title="Clip row" meta="default / selected">
                <div className="ds-clip-row selected">
                  <div className="ds-thumbnail"><span>01:24</span></div>
                  <div><b>Golden hour wide.mp4</b><span>Used in 2 beats</span></div>
                  <button aria-label="Clip options">•••</button>
                </div>
                <div className="ds-clip-row">
                  <div className="ds-thumbnail ds-thumbnail-alt"><span>00:38</span></div>
                  <div><b>Boardwalk detail.mp4</b><span>Available</span></div>
                  <button aria-label="Clip options">•••</button>
                </div>
              </Specimen>
              <Specimen title="Transport" meta="playback / timecode">
                <div className="ds-transport">
                  <PlayButton playing={transportPlaying} onPlayingChange={setTransportPlaying} />
                  <div className="ds-scrub">
                    <i style={{ width: `${(transportTime / TRANSPORT_DURATION) * 100}%` }} />
                  </div>
                  <code>{formatTransportTime(transportTime)}</code>
                </div>
                <div className="ds-transport-meta"><span>Preview quality</span><b>1080p</b><span>Frame rate</span><b>30 fps</b></div>
              </Specimen>
              <Specimen title="Timeline lane" meta="selected / voice / overlay" className="ds-span-2">
                <div className="ds-timeline">
                  <div className="ds-ruler"><span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span></div>
                  <div className="ds-lane"><label>Video</label><div><i className="clip one">Opening</i><i className="clip two">Product detail</i><i className="clip three">Reaction</i></div></div>
                  <div className="ds-lane"><label>Voice</label><div><i className="voice">Opening narration</i></div></div>
                  <div className="ds-playhead" />
                </div>
              </Specimen>
              <Specimen title="Dialog" meta="modal / destructive confirmation" className="ds-span-2">
                <div className="ds-dialog-demo">
                  <div>
                    <b>Dialogs are short, focused, and reversible when possible.</b>
                    <span>Open the live example to inspect hierarchy and actions.</span>
                  </div>
                  <button className="ds-button ds-button-ink" onClick={() => setShowDialog(true)}>Open dialog</button>
                </div>
              </Specimen>
              <Specimen title="Clip swap modal" meta="media grid / selection" className="ds-span-2">
                <div className="ds-dialog-demo">
                  <div>
                    <b>Choose a replacement from the project clip library.</b>
                    <span>The modal supports search, selected state, empty results, and keyboard dismissal.</span>
                  </div>
                  <button className="ds-button ds-button-ink" onClick={() => setSwapOpen(true)}>Swap clip</button>
                </div>
              </Specimen>
            </div>
          </Section>

          <footer className="ds-footer">
            <div className="ds-mark"><span className="ds-mark-symbol" aria-hidden="true"><i /><i /><i /></span><span>Cutroom System</span></div>
            <p>Built from the components already shaping the editor.</p>
            <a href="/">Return to editor</a>
          </footer>
        </main>
      </div>

      {showDialog && (
        <div className="ds-dialog-scrim" role="presentation" onMouseDown={() => setShowDialog(false)}>
          <div className="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="ds-dialog-close" aria-label="Close" title="Close (Esc)" onClick={() => setShowDialog(false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
            <span className="ds-dialog-label">Confirm removal</span>
            <h2 id="remove-dialog-title">Remove this clip?</h2>
            <p>The source file stays on your computer. This only removes it from the project.</p>
            <div className="ds-dialog-actions">
              <button className="ds-button ds-button-outline" onClick={() => setShowDialog(false)}>Cancel</button>
              <button className="ds-button ds-button-critical" onClick={() => setShowDialog(false)}>Remove clip</button>
            </div>
          </div>
        </div>
      )}
      <ClipSwapModal
        open={swapOpen}
        title="Swap Source Clip for Beat 01"
        items={swapClips}
        selectedId={selectedSwapClip}
        onSelect={setSelectedSwapClip}
        onClose={() => setSwapOpen(false)}
      />
    </div>
  );
}
