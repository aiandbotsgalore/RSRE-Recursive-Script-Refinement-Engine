/**
 * First-Time Listener Experience Model.
 *
 * Walks the documentary in presentation order and records what a listener with ZERO prior
 * knowledge has actually been told. The deterministic layer only records PRESENTED information
 * (what narration and tape actually say). AI predictions (inferences, curiosity, emotional
 * investment, fatigue) live in a separate `predicted` field and are always labeled as model
 * predictions, never as audience measurements.
 *
 * Future-knowledge leakage is prevented structurally: the simulation for scene N is computed
 * only from scenes 0..N, and `buildListenerContext` renders only audible material (no cue
 * headers, file names, source windows, preamble, or production appendix).
 */

import { parseManuscript, type ScriptSection } from "../scriptEngine";
import { contentHash, manuscriptVersionId } from "./hash";
import type { ProjectKnowledgeBase } from "./knowledgeBase";
import {
  buildStoryModel,
  findNamesInText,
  splitSentences,
  stripNarratorTag,
  quoteBody,
  spokenScenes,
  collectKnownNames,
  sceneContentHash,
  type StoryModel,
  type TapeUnit,
} from "./storyModel";

// ============================================================================
// Types
// ============================================================================

export type LoreFlagKind =
  | "unexplained_name"
  | "unexplained_term"
  | "unidentified_voice"
  | "undated_recordings";

export interface LoreFlag {
  id: string;
  scene_id: string;
  block_id: string;
  kind: LoreFlagKind;
  term: string;
  heard_in: "tape" | "narration" | "scene";
  excerpt: string;
  /** True when narration in the SAME scene resolves it after the listener first hears it (a deliberate reveal). */
  resolved_within_scene: boolean;
}

export interface PresentedRelationship {
  a: string;
  b: string;
  relation: string;
  scene_id: string;
  excerpt: string;
}

export interface ListenerQuestion {
  text: string;
  basis: "asked_in_narration" | "implied_by_exit_line" | "open_thread";
  source_excerpt: string;
}

/** AI prediction for one scene. Always a prediction, never an empirical measurement. */
export interface ListenerPrediction {
  provider_id: string;
  model: string;
  kind: "live" | "simulated";
  created_at: string;
  inferred: string[];
  curiosity: string;
  anticipation: string;
  emotional_investment: string;
  fatigue_risk: string;
  confusion: string[];
  motivation_to_continue: string;
  primary_question: string;
  disclaimer: string;
}

export interface ListenerSceneState {
  scene_id: string;
  index: number;
  scene_content_hash: string;
  /** Hash of everything the listener knew before this scene. Predictions are reused only if this matches. */
  upstream_hash: string;
  learned: string[];
  names_introduced: string[];
  terms_explained: string[];
  dates_heard: string[];
  voices_heard: number;
  voices_identified: number;
  relationships_presented: PresentedRelationship[];
  /** Cumulative view after this scene. */
  known_names: string[];
  explained_terms: string[];
  relationships_known: PresentedRelationship[];
  open_threads: string[];
  unknowns: string[];
  confusion: LoreFlag[];
  primary_question: ListenerQuestion | null;
  advances_understanding: boolean;
  new_information_count: number;
  exit_line: string;
  predicted: ListenerPrediction | null;
}

export interface ListenerTimeline {
  timeline_schema: 1;
  manuscript_version_id: string;
  project_id: string;
  created_at: string;
  states: ListenerSceneState[];
  /** Editorial-only annotation (NOT visible to the simulated listener): where each flag is resolved later. */
  editorial_resolutions: Record<string, string | null>;
}

// ============================================================================
// Helpers
// ============================================================================

const RELATION_RE =
  /\b(friend(?:s|ship)?|dating|relationship|co-host(?:ing)?|supported|mothers?|husband|wife|ex(?:es)?|daughter|son|family|enemy|defended)\b/i;
const EXPLANATION_RE =
  /\b(?:called|named|known as|goes by|which is|which means|means|refers to|is a|are|was a|were|is where|formerly)\b/i;
const QUESTION_RE = /\?\s*$/;

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function termRegex(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}

function excerpt(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Converts a production cue into what a listener would hear, or null if it is not audible. */
function audibleCue(text: string): string | null {
  const t = text.toUpperCase();
  if (/\bSILENCE|PAUSE|ROOM TONE|BREATH\b/.test(t)) return "(pause)";
  if (/\bMOTIF\b/.test(t)) return "(short musical motif)";
  return null;
}

// ============================================================================
// Simulation
// ============================================================================

interface SimulationState {
  knownNames: Set<string>;
  identifiedVoices: Set<string>;
  explainedTerms: Set<string>;
  relationships: PresentedRelationship[];
  openThreads: string[];
  /** Terms and names already flagged once; repeated confusion is not re-flagged in every scene. */
  flagged: Set<string>;
}

/** Narration places the narrator inside the relationship only with explicit first-person framing. */
const NARRATOR_RELATION_RE =
  /\b(?:my (?:friend|girlfriend|relationship)|our friendship|I was (?:her|his|their) friend|Sav and I|we (?:were|started) (?:dating|a relationship)|I (?:helped|defended) (?:her|him))\b/i;

function snapshotHash(s: SimulationState): string {
  return contentHash(
    JSON.stringify({
      n: Array.from(s.knownNames).sort(),
      v: Array.from(s.identifiedVoices).sort(),
      t: Array.from(s.explainedTerms).sort(),
      r: s.relationships.map((r) => `${r.a}|${r.b}|${r.relation}`).sort(),
      o: s.openThreads,
      f: Array.from(s.flagged).sort(),
    })
  );
}

function simulateScene(
  sec: ScriptSection,
  index: number,
  units: TapeUnit[],
  knownNamesUniverse: string[],
  kb: ProjectKnowledgeBase,
  state: SimulationState
): ListenerSceneState {
  const upstream = snapshotHash(state);
  const learned: string[] = [];
  const namesIntroduced: string[] = [];
  const termsExplained: string[] = [];
  const datesHeard: string[] = [];
  const relationshipsPresented: PresentedRelationship[] = [];
  const confusion: LoreFlag[] = [];
  const questions: ListenerQuestion[] = [];
  let voicesHeard = 0;
  let voicesIdentified = 0;
  let exitLine = "";

  const unitByHeaderBlock = new Map(units.map((u) => [u.block_ids.find((id) => sec.blocks.find((b) => b.id === id && (b.type === "archival" || b.type === "reading"))) || "", u]));
  const pendingVoices: Array<{ flag: LoreFlag; speaker: string; count: number }> = [];
  const pendingNames: Array<{ flag: LoreFlag; name: string }> = [];
  const pendingTerms: Array<{ flag: LoreFlag; term: string }> = [];
  let undatedCount = 0;
  const sceneNarration = sec.blocks
    .filter((b) => b.type === "narrator")
    .map((b) => stripNarratorTag(b.rawText))
    .join(" ");

  const introduceName = (name: string, sentence: string) => {
    if (name === kb.narrator_name) return;
    if (!state.knownNames.has(name)) {
      state.knownNames.add(name);
      namesIntroduced.push(name);
      learned.push(`Introduced: ${name} ("${excerpt(sentence, 100)}")`);
    }
    for (const p of pendingNames) if (p.name === name) p.flag.resolved_within_scene = true;
    for (const p of pendingVoices) {
      if (p.speaker === name && !p.flag.resolved_within_scene) {
        p.flag.resolved_within_scene = true;
        state.identifiedVoices.add(name);
        voicesIdentified += p.count;
      }
    }
  };

  const checkTerms = (text: string, heardIn: "tape" | "narration", blockId: string, explaining: boolean) => {
    for (const g of kb.glossary) {
      if (state.explainedTerms.has(g.term)) continue;
      const re = termRegex(g.pattern);
      if (!re.test(text)) continue;
      if (explaining) {
        state.explainedTerms.add(g.term);
        termsExplained.push(g.term);
        learned.push(`Context explained: ${g.term}`);
        for (const p of pendingTerms) if (p.term === g.term) p.flag.resolved_within_scene = true;
        continue;
      }
      if (state.flagged.has(`term:${g.term}`)) continue;
      state.flagged.add(`term:${g.term}`);
      const flag: LoreFlag = {
        id: `TERM-${sec.section_id}-${blockId}-${g.term}`,
        scene_id: sec.section_id,
        block_id: blockId,
        kind: "unexplained_term",
        term: g.term,
        heard_in: heardIn,
        excerpt: excerpt(text.match(re) ? text.slice(Math.max(0, text.search(re) - 50), text.search(re) + 70) : text),
        resolved_within_scene: false,
      };
      confusion.push(flag);
      pendingTerms.push({ flag, term: g.term });
    }
  };

  for (const block of sec.blocks) {
    if (block.type === "narrator") {
      const text = stripNarratorTag(block.rawText);
      const sentences = splitSentences(text);
      for (const sentence of sentences) {
        for (const name of findNamesInText(sentence, knownNamesUniverse, kb)) introduceName(name, sentence);
        checkTerms(sentence, "narration", block.id, EXPLANATION_RE.test(sentence));
        for (const d of sentence.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/g) || []) {
          if (!datesHeard.includes(d)) datesHeard.push(d);
        }
        const rel = RELATION_RE.exec(sentence);
        if (rel) {
          const people = findNamesInText(sentence, knownNamesUniverse, kb).filter((p) => p !== kb.narrator_name);
          const withNarrator = NARRATOR_RELATION_RE.test(sentence) ? uniq([kb.narrator_name, ...people]) : people;
          if (withNarrator.length >= 2) {
            const r: PresentedRelationship = {
              a: withNarrator[0],
              b: withNarrator[1],
              relation: rel[1].toLowerCase(),
              scene_id: sec.section_id,
              excerpt: excerpt(sentence, 120),
            };
            if (!state.relationships.some((x) => x.a === r.a && x.b === r.b && x.relation === r.relation)) {
              state.relationships.push(r);
              relationshipsPresented.push(r);
              learned.push(`Relationship: ${r.a} and ${r.b} (${r.relation})`);
            }
          }
        }
        if (QUESTION_RE.test(sentence)) {
          questions.push({ text: sentence, basis: "asked_in_narration", source_excerpt: excerpt(sentence) });
        }
        const promise = /\b(?:we'll|we will|I'll)\s+(?:return|come back|get back)\s+to\b[^.]*/i.exec(sentence);
        if (promise) state.openThreads.push(excerpt(sentence, 120));
      }
      if (sentences.length > 0) exitLine = sentences[sentences.length - 1];
      continue;
    }

    if (block.type === "archival" || block.type === "reading") {
      const unit = unitByHeaderBlock.get(block.id);
      if (!unit) continue;
      voicesHeard++;
      const speaker = unit.speakers[0];
      if (speaker && speaker !== kb.narrator_name) {
        if (state.identifiedVoices.has(speaker) || state.knownNames.has(speaker)) {
          state.identifiedVoices.add(speaker);
          voicesIdentified++;
        } else if (pendingVoices.some((p) => p.speaker === speaker)) {
          const pending = pendingVoices.find((p) => p.speaker === speaker);
          if (pending) pending.count++;
        } else {
          const flag: LoreFlag = {
            id: `VOICE-${sec.section_id}-${block.id}`,
            scene_id: sec.section_id,
            block_id: block.id,
            kind: "unidentified_voice",
            term: speaker,
            heard_in: "tape",
            excerpt: excerpt(unit.quote_text, 100),
            resolved_within_scene: false,
          };
          confusion.push(flag);
          pendingVoices.push({ flag, speaker, count: 1 });
        }
      } else if (speaker === kb.narrator_name) {
        voicesIdentified++;
      }
      // Names spoken inside the tape that the listener has not been introduced to.
      for (const name of findNamesInText(unit.quote_text, knownNamesUniverse, kb)) {
        if (name === kb.narrator_name || state.knownNames.has(name)) continue;
        if (state.flagged.has(`name:${name}`)) continue;
        state.flagged.add(`name:${name}`);
        const flag: LoreFlag = {
          id: `NAME-${sec.section_id}-${block.id}-${name}`,
          scene_id: sec.section_id,
          block_id: block.id,
          kind: "unexplained_name",
          term: name,
          heard_in: "tape",
          excerpt: excerpt(unit.quote_text, 100),
          resolved_within_scene: false,
        };
        confusion.push(flag);
        pendingNames.push({ flag, name });
      }
      // A speaker on tape can explain a term themselves ("when I say swatted, I mean...").
      checkTerms(unit.quote_text, "tape", block.id, /\b(?:when I say|I mean,? like|which means)\b/i.test(unit.quote_text));
      const datedInNarration =
        unit.cue_dates.some((d) => sceneNarration.includes(d)) ||
        (unit.show_title ? sceneNarration.includes(unit.show_title) : false);
      if (unit.cue_dates.length > 0 && !datedInNarration) undatedCount++;
      continue;
    }
  }

  const narrationHasAnyDate = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/.test(sceneNarration);
  if (undatedCount >= 3 && !narrationHasAnyDate) {
    confusion.push({
      id: `UNDATED-${sec.section_id}`,
      scene_id: sec.section_id,
      block_id: "",
      kind: "undated_recordings",
      term: `${undatedCount} recordings`,
      heard_in: "scene",
      excerpt: `${undatedCount} recordings in this scene are dated only in production notes; the listener cannot place them in time.`,
      resolved_within_scene: false,
    });
  }

  let primary: ListenerQuestion | null = null;
  if (questions.length > 0) {
    primary = questions[questions.length - 1];
  } else if (exitLine) {
    primary = { text: exitLine, basis: "implied_by_exit_line", source_excerpt: excerpt(exitLine) };
  } else if (state.openThreads.length > 0) {
    const t = state.openThreads[state.openThreads.length - 1];
    primary = { text: t, basis: "open_thread", source_excerpt: t };
  }

  const unresolved = confusion.filter((c) => !c.resolved_within_scene);
  const unknowns = uniq(unresolved.map((c) => (c.kind === "unidentified_voice" ? `Who is the voice saying "${c.excerpt.slice(0, 50)}"?` : c.kind === "undated_recordings" ? c.excerpt : `Who or what is "${c.term}"?`)));
  const newInfo = namesIntroduced.length + termsExplained.length + relationshipsPresented.length + datesHeard.length;

  return {
    scene_id: sec.section_id,
    index,
    scene_content_hash: sceneContentHash(sec),
    upstream_hash: upstream,
    learned,
    names_introduced: namesIntroduced,
    terms_explained: termsExplained,
    dates_heard: datesHeard,
    voices_heard: voicesHeard,
    voices_identified: voicesIdentified,
    relationships_presented: relationshipsPresented,
    known_names: Array.from(state.knownNames),
    explained_terms: Array.from(state.explainedTerms),
    relationships_known: [...state.relationships],
    open_threads: [...state.openThreads],
    unknowns,
    confusion,
    primary_question: primary,
    advances_understanding: newInfo > 0,
    new_information_count: newInfo,
    exit_line: exitLine,
    predicted: null,
  };
}

/**
 * Runs the deterministic listener simulation. Reuses AI predictions from `previous`
 * only when both the scene content AND everything heard before it are unchanged.
 */
export function simulateListenerTimeline(
  markdown: string,
  kb: ProjectKnowledgeBase,
  model?: StoryModel | null,
  previous?: ListenerTimeline | null
): ListenerTimeline {
  const storyModel = model || buildStoryModel(markdown, kb);
  const parsed = parseManuscript(markdown);
  const scenes = spokenScenes(parsed);
  const knownNamesUniverse = collectKnownNames(storyModel.tape_units, kb);
  const state: SimulationState = {
    knownNames: new Set(),
    identifiedVoices: new Set(),
    explainedTerms: new Set(),
    relationships: [],
    openThreads: [],
    flagged: new Set(),
  };
  const prevByScene = new Map((previous?.states || []).map((s) => [s.scene_id, s]));

  const states = scenes.map((sec, i) => {
    const units = storyModel.tape_units.filter((u) => u.scene_id === sec.section_id);
    const st = simulateScene(sec, i, units, knownNamesUniverse, kb, state);
    // The AI listener context for scene i includes the previous scene's audio, so it is part of the upstream identity.
    if (i > 0) st.upstream_hash = contentHash(`${st.upstream_hash}|${sceneContentHash(scenes[i - 1])}`);
    const prev = prevByScene.get(sec.section_id);
    if (prev && prev.predicted && prev.scene_content_hash === st.scene_content_hash && prev.upstream_hash === st.upstream_hash) {
      st.predicted = prev.predicted;
    }
    return st;
  });

  // Editorial-only: where would each unresolved flag eventually be resolved? (Never shown to the listener simulation.)
  const resolutions: Record<string, string | null> = {};
  for (const st of states) {
    for (const flag of st.confusion) {
      if (flag.resolved_within_scene) continue;
      let resolvedIn: string | null = null;
      for (const later of states.slice(st.index + 1)) {
        if (
          (flag.kind === "unexplained_name" || flag.kind === "unidentified_voice") &&
          later.names_introduced.includes(flag.term)
        ) {
          resolvedIn = later.scene_id;
          break;
        }
        if (flag.kind === "unexplained_term" && later.terms_explained.includes(flag.term)) {
          resolvedIn = later.scene_id;
          break;
        }
      }
      resolutions[flag.id] = resolvedIn;
    }
  }

  return {
    timeline_schema: 1,
    manuscript_version_id: manuscriptVersionId(markdown),
    project_id: kb.project_id,
    created_at: new Date().toISOString(),
    states,
    editorial_resolutions: resolutions,
  };
}

/** Indices whose AI prediction is missing or invalidated. Used for selective, incremental AI calls. */
export function scenesNeedingPrediction(timeline: ListenerTimeline): number[] {
  return timeline.states.filter((s) => !s.predicted).map((s) => s.index);
}

export function attachPrediction(timeline: ListenerTimeline, sceneId: string, prediction: ListenerPrediction): ListenerTimeline {
  return {
    ...timeline,
    states: timeline.states.map((s) => (s.scene_id === sceneId ? { ...s, predicted: prediction } : s)),
  };
}

// ============================================================================
// Leak-free context for AI listener simulation
// ============================================================================

/** Renders a scene as audio a listener hears. Speakers are named only once the listener knows them. */
export function renderSceneForListener(
  sec: ScriptSection,
  units: TapeUnit[],
  knownBefore: Set<string>,
  kb: ProjectKnowledgeBase
): string {
  const lines: string[] = [];
  const known = new Set(knownBefore);
  const unitByBlock = new Map<string, TapeUnit>();
  for (const u of units) for (const id of u.block_ids) unitByBlock.set(id, u);
  let anonCounter = 0;
  const anonLabels = new Map<string, string>();
  const narrationNames = (t: string) => findNamesInText(t, Array.from(new Set([...units.flatMap((u) => u.speakers), ...kb.additional_named_people, ...Object.values(kb.name_aliases)])), kb);

  for (const b of sec.blocks) {
    if (b.type === "narrator") {
      const t = stripNarratorTag(b.rawText);
      narrationNames(t).forEach((n) => known.add(n));
      lines.push(`NARRATOR (${kb.narrator_name}, first person): ${t.replace(/\s+/g, " ")}`);
    } else if (b.type === "archival" || b.type === "reading") {
      const u = unitByBlock.get(b.id);
      const speaker = u?.speakers[0] || "";
      let label: string;
      if (speaker === kb.narrator_name) label = `${kb.narrator_name} (recorded)`;
      else if (speaker && known.has(speaker)) label = speaker;
      else {
        if (!anonLabels.has(speaker)) anonLabels.set(speaker, `UNIDENTIFIED VOICE ${String.fromCharCode(65 + anonCounter++)}`);
        label = anonLabels.get(speaker) as string;
      }
      lines.push(b.type === "reading" ? `NARRATOR READS A WRITTEN MESSAGE (sender as yet: ${label}):` : `TAPE, ${label}:`);
    } else if (b.type === "blockquote") {
      lines.push(`  "${quoteBody(b.rawText).replace(/\s+/g, " ")}"`);
    } else {
      const cue = audibleCue(b.rawText);
      if (cue) lines.push(cue);
    }
  }
  return lines.join("\n");
}

export interface ListenerContext {
  persona: string;
  scene_id: string;
  scene_index: number;
  prior_knowledge: {
    known_names: string[];
    explained_terms: string[];
    relationships: string[];
    open_threads: string[];
    previous_questions: string[];
  };
  previous_scene_audio: string;
  current_scene_audio: string;
}

/**
 * Builds the ONLY input a simulated cold listener may receive for scene `sceneIndex`:
 * the accumulated knowledge state, the immediately previous scene as heard, and the current scene as heard.
 */
export function buildListenerContext(
  markdown: string,
  kb: ProjectKnowledgeBase,
  sceneIndex: number,
  timeline: ListenerTimeline,
  model?: StoryModel | null,
  previousSceneCharBudget = 2500
): ListenerContext {
  const storyModel = model || buildStoryModel(markdown, kb);
  const scenes = spokenScenes(parseManuscript(markdown));
  const sec = scenes[sceneIndex];
  if (!sec) throw new Error(`Scene index ${sceneIndex} out of range.`);
  const prior = sceneIndex > 0 ? timeline.states[sceneIndex - 1] : null;
  const knownBefore = new Set(prior ? prior.known_names : []);
  const unitsFor = (s: ScriptSection) => storyModel.tape_units.filter((u) => u.scene_id === s.section_id);

  let previousAudio = "";
  if (sceneIndex > 0) {
    const prevSec = scenes[sceneIndex - 1];
    const beforePrev = new Set(sceneIndex > 1 ? timeline.states[sceneIndex - 2].known_names : []);
    previousAudio = renderSceneForListener(prevSec, unitsFor(prevSec), beforePrev, kb);
    if (previousAudio.length > previousSceneCharBudget) {
      previousAudio = "…" + previousAudio.slice(previousAudio.length - previousSceneCharBudget);
    }
  }

  return {
    persona: kb.listener_persona,
    scene_id: sec.section_id,
    scene_index: sceneIndex,
    prior_knowledge: {
      known_names: prior ? prior.known_names : [],
      explained_terms: prior ? prior.explained_terms : [],
      relationships: prior ? prior.relationships_known.map((r) => `${r.a} and ${r.b}: ${r.relation}`) : [],
      open_threads: prior ? prior.open_threads : [],
      previous_questions: timeline.states
        .slice(0, sceneIndex)
        .map((s) => s.predicted?.primary_question || s.primary_question?.text || "")
        .filter(Boolean)
        .slice(-4),
    },
    previous_scene_audio: previousAudio,
    current_scene_audio: renderSceneForListener(sec, unitsFor(sec), knownBefore, kb),
  };
}

export interface IsolationViolation {
  kind: "future_content" | "production_metadata" | "appendix_or_preamble";
  detail: string;
}

/** Verifies that a listener context contains nothing from later scenes or from production-only material. */
export function verifyListenerIsolation(
  context: ListenerContext,
  markdown: string,
  kb: ProjectKnowledgeBase
): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  const parsed = parseManuscript(markdown);
  const scenes = spokenScenes(parsed);
  const serialized = JSON.stringify(context);
  const flat = serialized.replace(/\\n/g, " ").replace(/\s+/g, " ");

  for (const later of scenes.slice(context.scene_index + 1)) {
    for (const b of later.blocks) {
      if (b.type !== "blockquote" && b.type !== "narrator") continue;
      const body = (b.type === "blockquote" ? quoteBody(b.rawText) : stripNarratorTag(b.rawText)).replace(/\s+/g, " ").trim();
      if (body.length < 40) continue;
      const probe = body.slice(0, 60);
      // Skip probes that also occur in permitted scenes (reprised tape is legitimately heard earlier).
      const permitted = scenes
        .slice(0, context.scene_index + 1)
        .some((s) => s.rawMarkdown.replace(/\s+/g, " ").includes(probe));
      if (!permitted && flat.includes(probe)) {
        violations.push({ kind: "future_content", detail: `${later.section_id}/${b.id}: "${probe}"` });
      }
    }
  }
  for (const marker of [/\.txt\b/i, /\/segments\//i, /source window/i, /V3 locator/i, /\.json\b/i]) {
    if (marker.test(flat)) violations.push({ kind: "production_metadata", detail: `Context contains ${marker}` });
  }
  const appendix = parsed.sections.find((s) => s.section_id === "APPENDIX");
  if (appendix) {
    const probe = appendix.rawMarkdown.replace(/\s+/g, " ").slice(40, 110);
    if (probe.length > 20 && flat.includes(probe)) violations.push({ kind: "appendix_or_preamble", detail: "Production appendix text found" });
  }
  if (parsed.preamble) {
    const probe = parsed.preamble.replace(/\s+/g, " ").slice(60, 130);
    if (probe.length > 20 && flat.includes(probe)) violations.push({ kind: "appendix_or_preamble", detail: "Editorial preamble text found" });
  }
  void kb;
  return violations;
}

export function getListenerStateForScene(timeline: ListenerTimeline, sceneId: string): ListenerSceneState | undefined {
  return timeline.states.find((s) => s.scene_id.toUpperCase() === sceneId.toUpperCase());
}
