/**
 * Narrative Intelligence Model (deterministic layer + semantic cache).
 *
 * Everything structural is DERIVED from the manuscript: scene list and order, tape units,
 * speakers, names, dates, and the dependencies between scenes. Project-specific knowledge
 * (aliases, glossary) arrives through a ProjectKnowledgeBase. Higher-level creative judgments
 * are stored as semantic annotations keyed by scene content hash, so an unchanged scene keeps
 * its analysis across versions and only changed scenes (and their dependents) go stale.
 */

import {
  parseManuscript,
  analyzeCrossChapterResonance,
  type ParsedManuscript,
  type ScriptBlock,
  type ScriptSection,
} from "../scriptEngine";
import { contentHash, manuscriptVersionId } from "./hash";
import type { ProjectKnowledgeBase } from "./knowledgeBase";

// ============================================================================
// Types
// ============================================================================

export type ProtectedKind = "archival_cue" | "reading_cue" | "quote" | "production_cue";

/** Identity of an immutable block. `pid` is content based, so it survives repositioning. */
export interface ProtectedBlockIdentity {
  pid: string;
  kind: ProtectedKind;
  content_hash: string;
  occurrence: number;
  scene_id: string;
  block_id: string;
  text: string;
}

export interface TapeUnit {
  unit_id: string;
  scene_id: string;
  unit_index_in_scene: number;
  kind: "archival" | "reading";
  /** Positional block ids (valid only for the manuscript version this model was built from). */
  block_ids: string[];
  /** Protected identities of every block in the unit, in order. */
  pids: string[];
  header_text: string;
  archival_number: number | null;
  speakers: string[];
  show_title: string | null;
  cue_dates: string[];
  quote_text: string;
  /** Other ARCHIVAL numbers this cue explicitly references ("same original transcript as ARCHIVAL 02"). */
  referenced_archival_numbers: number[];
  /** Cue states that it depends on the audio immediately before it ("The preceding audio establishes..."). */
  requires_preceding_unit: boolean;
  reprise_of_unit_id: string | null;
}

export type SceneRole = "crucial_turn" | "human_texture" | "pacing_drag";
export type MacroAction = "keep" | "move" | "merge" | "trim";

/** Separates what kind of support a claim has (Safeguard A). */
export type ClaimBasis =
  | "established_in_manuscript"
  | "narrator_perspective"
  | "interpretation"
  | "disputed"
  | "creative_recommendation"
  | "deterministic_signal";

export interface SceneSignals {
  narration_words: number;
  tape_words: number;
  reading_units: number;
  archival_units: number;
  document_mentions: number;
  new_names: string[];
  new_dates: string[];
  escalation_markers: string[];
  reprise_units: number;
  inbound_callbacks: number;
  has_flashback: boolean;
  document_heavy: boolean;
}

export interface SceneNode {
  scene_id: string;
  index: number;
  title: string;
  content_hash: string;
  narrator_block_ids: string[];
  tape_unit_ids: string[];
  speakers: string[];
  names_in_narration: string[];
  dates_in_narration: string[];
  signals: SceneSignals;
  role: SceneRole;
  role_basis: ClaimBasis;
  role_reasons: string[];
  macro_action: MacroAction;
  macro_reason: string;
}

export type DependencyKind =
  | "callback"
  | "promise"
  | "flashback"
  | "ordinal_reference"
  | "tape_reference"
  | "resonance"
  | "character_thread";

export interface DependencyEdge {
  id: string;
  kind: DependencyKind;
  from_scene_id: string;
  to_scene_id: string;
  evidence: string;
  block_id?: string;
}

export interface CharacterThread {
  name: string;
  scene_ids: string[];
  first_scene_id: string;
  first_named_in_narration_scene_id: string | null;
  tape_unit_count: number;
}

export interface PacingBottleneck {
  scene_ids: string[];
  reason: string;
}

/** AI-produced creative judgment for one scene. Always labeled with its provider and kind. */
export interface SceneSemantic {
  scene_content_hash: string;
  scene_id: string;
  provider_id: string;
  model: string;
  kind: "live" | "simulated";
  created_at: string;
  scene_purpose: string;
  dramatic_question: string;
  stakes: string;
  role_assessment: SceneRole | null;
  character_development: string[];
  opportunities: string[];
  confidence: number;
}

export interface StoryModel {
  model_schema: 1;
  project_id: string;
  manuscript_version_id: string;
  parent_version_id: string | null;
  created_at: string;
  scenes: SceneNode[];
  tape_units: TapeUnit[];
  protected_blocks: ProtectedBlockIdentity[];
  dependencies: DependencyEdge[];
  characters: CharacterThread[];
  bottlenecks: PacingBottleneck[];
  /** Semantic annotations keyed by scene content hash (reused across versions while a scene is unchanged). */
  semantic: Record<string, SceneSemantic>;
  /** Scenes whose content changed relative to the parent version. */
  changed_scene_ids: string[];
  /** Scenes whose semantic analysis is missing or invalidated by a change they depend on. */
  stale_scene_ids: string[];
  /** Listener states from this index onward must be recomputed (prior knowledge changed). */
  listener_stale_from_index: number;
}

// ============================================================================
// Text helpers
// ============================================================================

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_RE = new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, "g");

const NARRATOR_TAG_RE = /^\s*\*{0,2}\[(?:LOGAN(?:\s*—\s*NARRATION)?|(?:Male\s+)?Narrator|Host)[^\]]*\]\*{0,2}\s*:?/i;

export function stripNarratorTag(text: string): string {
  return text.replace(NARRATOR_TAG_RE, "").trim();
}

export function quoteBody(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘*_])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SPEAKER_STOPWORDS = new Set([
  "CONTINUOUS", "EXCHANGE", "EDITED", "PARTICIPANT", "OTHER", "A", "AN", "THE", "DIFFERENT",
  "DELIVERY", "HER", "HIS", "RESPONSE", "READ", "BY", "CLEARLY", "NOT", "ARCHIVAL", "VOICE",
  "CLIP", "IN", "TRANSCRIPT", "TWO", "SEPARATE", "MESSAGES", "MESSAGE", "FINAL", "ADDRESSING",
  "TO", "SOURCE", "HANDOFF", "WRITTEN", "READING", "SELECTED", "SENTENCES", "AND", "OF",
]);

/** Extracts speaker names from a cue header such as `[ARCHIVAL 16 — CONTINUOUS EXCHANGE, ANGELA / LYNN | ...]`. */
export function parseCueSpeakers(header: string, kb: ProjectKnowledgeBase): string[] {
  const inner = header.replace(/^\s*\*{0,2}\[/, "").replace(/\]\*{0,2}\s*$/, "");
  const dashIdx = inner.indexOf("—");
  if (dashIdx === -1) return [];
  const afterDash = inner.slice(dashIdx + 1);
  const pipeIdx = afterDash.indexOf("|");
  let segment = pipeIdx === -1 ? afterDash : afterDash.slice(0, pipeIdx);

  // "READ BY LOGAN ... | Angela to Sav, July 15" names the narrator as reader; the sender follows the pipe.
  if (/\bREAD BY\b/i.test(segment) && pipeIdx !== -1) {
    const afterPipe = afterDash.slice(pipeIdx + 1).split("|")[0];
    const senderMatch = /^\s*([A-Za-z]+)\s+to\s+([A-Za-z]+)/i.exec(afterPipe);
    if (senderMatch) segment = `${senderMatch[1]} TO ${senderMatch[2]}`;
  }

  const tokens = segment
    .toUpperCase()
    .replace(/["“”]/g, " ")
    .split(/[^A-Z'’]+/)
    .filter((t) => t.length > 1 && !SPEAKER_STOPWORDS.has(t));

  const names = tokens.map((t) => canonicalName(titleCase(t), kb));
  // Message cues are "SENDER TO RECIPIENT"; speaker of the words is the sender.
  return uniq(names);
}

export function canonicalName(name: string, kb: ProjectKnowledgeBase): string {
  const alias = kb.name_aliases[name.toLowerCase()];
  return alias || name;
}

function extractDates(text: string): string[] {
  return uniq((text.match(DATE_RE) || []).map((d) => d.replace(/,\s*\d{4}$/, "")));
}

function isProductionCue(block: ScriptBlock): boolean {
  return block.type === "locked_meta" && /^\s*\*{0,2}\[/.test(block.rawText);
}

function isHeadingOrRule(block: ScriptBlock): boolean {
  const t = block.rawText.trim();
  return t.startsWith("#") || /^(?:---|\*\*\*|___)\s*$/.test(t);
}

/** Cues that describe the aftermath of the preceding tape rather than an entry into the next one. */
const TRAILING_CUE_RE = /\b(?:SILENCE|ROOM TONE|BREATH|PAUSE|LET (?:HER|HIM|LYNN|THE)|NO MUSIC|DON'T (?:ADD|REPEAT)|ALLOW|LONGER PAUSE|BRIEF SILENCE|BEAT)\b/i;
/** Cues that lead into the next tape. */
const LEADING_CUE_RE = /\b(?:HARD CUT TO|CUT TO|DROP ALL MUSIC|RETURN TO THE ROOM|NO MUSIC\. ORIGINAL)\b/i;

// ============================================================================
// Protected blocks and tape units
// ============================================================================

export function protectedKindOf(block: ScriptBlock): ProtectedKind | null {
  if (block.type === "blockquote") return "quote";
  if (block.type === "archival") return "archival_cue";
  if (block.type === "reading") return "reading_cue";
  if (isProductionCue(block)) return "production_cue";
  return null;
}

/** Builds content-based identities for every protected block, numbering repeated identical text. */
export function collectProtectedBlocks(parsed: ParsedManuscript): ProtectedBlockIdentity[] {
  const seen = new Map<string, number>();
  const out: ProtectedBlockIdentity[] = [];
  for (const sec of parsed.sections) {
    if (sec.section_id === "APPENDIX") continue;
    for (const b of sec.blocks) {
      const kind = protectedKindOf(b);
      if (!kind) continue;
      const h = contentHash(b.rawText);
      const key = `${kind}:${h}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      out.push({
        pid: `${kind}:${h}:${occurrence}`,
        kind,
        content_hash: h,
        occurrence,
        scene_id: sec.section_id,
        block_id: b.id,
        text: b.rawText,
      });
    }
  }
  return out;
}

/**
 * Groups a scene's blocks into tape units: a cue header, its quotes, intra-unit edit cues,
 * plus leading cues ("HARD CUT TO ...") and trailing cues ("BRIEF SILENCE.").
 * Moving a unit moves all of these together so speaker identification and cut
 * directions are never separated from the recording.
 */
export function extractTapeUnits(
  sec: ScriptSection,
  pidByBlockId: Map<string, string>,
  kb: ProjectKnowledgeBase
): TapeUnit[] {
  const units: TapeUnit[] = [];
  const blocks = sec.blocks;
  let i = 0;
  let unitIndex = 0;

  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type !== "archival" && b.type !== "reading") {
      i++;
      continue;
    }

    // Leading cues directly before the header that point into this tape.
    let start = i;
    while (
      start - 1 >= 0 &&
      isProductionCue(blocks[start - 1]) &&
      LEADING_CUE_RE.test(blocks[start - 1].rawText) &&
      !units.some((u) => u.block_ids.includes(blocks[start - 1].id))
    ) {
      start--;
    }

    let end = i + 1;
    while (end < blocks.length) {
      const nb = blocks[end];
      if (nb.type === "blockquote") {
        end++;
        continue;
      }
      if (isProductionCue(nb)) {
        // Stop before a cue that leads into the next tape.
        const next = blocks[end + 1];
        const leadsIntoNext =
          LEADING_CUE_RE.test(nb.rawText) && next && (next.type === "archival" || next.type === "reading");
        if (leadsIntoNext) break;
        // An edit cue between two quotes belongs to this unit; a trailing cue closes it.
        const followedByQuote = next && next.type === "blockquote";
        if (followedByQuote || TRAILING_CUE_RE.test(nb.rawText) || /^\s*\[HARD CUT\.?\]\s*$/i.test(nb.rawText)) {
          end++;
          if (!followedByQuote) break;
          continue;
        }
        break;
      }
      break;
    }

    const unitBlocks = blocks.slice(start, end);
    const header = b.rawText;
    const numMatch = /ARCHIVAL\s+(\d{1,3})/i.exec(header);
    const ownNumber = numMatch ? parseInt(numMatch[1], 10) : null;
    const referenced = uniq(
      Array.from(header.matchAll(/ARCHIVAL\s+(\d{1,3})/gi))
        .map((m) => parseInt(m[1], 10))
        .filter((n) => n !== ownNumber)
    );
    const quoteText = unitBlocks
      .filter((x) => x.type === "blockquote")
      .map((x) => quoteBody(x.rawText))
      .join("\n");
    const showMatch = /\*([^*]+)\*/.exec(header);

    units.push({
      unit_id: pidByBlockId.get(b.id) || `${sec.section_id}:${b.id}`,
      scene_id: sec.section_id,
      unit_index_in_scene: unitIndex++,
      kind: b.type === "archival" ? "archival" : "reading",
      block_ids: unitBlocks.map((x) => x.id),
      pids: unitBlocks.map((x) => pidByBlockId.get(x.id) || x.id),
      header_text: header,
      archival_number: ownNumber,
      speakers: parseCueSpeakers(header, kb),
      show_title: showMatch ? showMatch[1].trim() : null,
      cue_dates: extractDates(header),
      quote_text: quoteText,
      referenced_archival_numbers: referenced,
      requires_preceding_unit: /\bpreceding audio\b/i.test(header),
      reprise_of_unit_id: null,
    });
    i = end;
  }
  return units;
}

function shingles(text: string, size = 8): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

function markReprises(units: TapeUnit[]): void {
  const prior: Array<{ unit: TapeUnit; sh: Set<string> }> = [];
  for (const u of units) {
    const sh = shingles(u.quote_text);
    for (const p of prior) {
      if (p.unit.scene_id === u.scene_id) continue;
      let overlap = 0;
      for (const s of sh) if (p.sh.has(s)) overlap++;
      if (overlap >= 2) {
        u.reprise_of_unit_id = p.unit.unit_id;
        break;
      }
    }
    prior.push({ unit: u, sh });
  }
}

// ============================================================================
// Names, dates, dependencies
// ============================================================================

export function collectKnownNames(units: TapeUnit[], kb: ProjectKnowledgeBase): string[] {
  const names = new Set<string>();
  for (const u of units) u.speakers.forEach((s) => names.add(s));
  kb.additional_named_people.forEach((n) => names.add(n));
  Object.values(kb.name_aliases).forEach((n) => names.add(n));
  names.add(kb.narrator_name);
  return Array.from(names).filter((n) => n.length > 1);
}

/** Variants that refer to a canonical name (the name itself plus alias spellings). */
export function nameVariants(name: string, kb: ProjectKnowledgeBase): string[] {
  const variants = [name];
  for (const [alias, canon] of Object.entries(kb.name_aliases)) {
    if (canon === name && alias.split(" ").length === 1) variants.push(titleCase(alias));
  }
  return uniq(variants);
}

export function findNamesInText(text: string, knownNames: string[], kb: ProjectKnowledgeBase): string[] {
  const found: string[] = [];
  for (const name of knownNames) {
    const re = new RegExp(`\\b(?:${nameVariants(name, kb).map(escapeRe).join("|")})\\b`);
    if (re.test(text)) found.push(name);
  }
  return found;
}

const ESCALATION_RE =
  /\b(?:publish(?:ed|ing)?|posting|post them|releas(?:e|ed|ing)|CPS|c p s|child services|child-welfare|police|cops|welfare check|doxed|swatted|ruin every|threat(?:en(?:ed|ing)?)?|predator)\b/gi;
const DOCUMENT_RE = /\b(?:screenshots?|messages?|DMs?|newsletter|group (?:chat|conversation)|written|chat)\b/gi;
/** Narration that sets two statements or moments side by side across time (contradiction evolution). */
const JUXTAPOSITION_RE =
  /\b(?:the timing is|the tension is|and yet|one week after|(?:a few|two|three) days (?:later|after)|in the same broadcast|later that same|contradict(?:s|ion|ory)?)\b/gi;
const FLASHBACK_RE =/\b(?:take you back|back a little earlier|a little earlier on|I want to go back)\b/i;
const ORDINAL_REF_RE =
  /\b(?:the\s+)?(?:first|second|third|last)\s+(?:group of\s+)?(?:recordings?|clips?)\b|\bthe recordings you just heard\b|\bthe ones you just heard\b/i;

function narratorText(sec: ScriptSection): string {
  return sec.blocks
    .filter((b) => b.type === "narrator")
    .map((b) => stripNarratorTag(b.rawText))
    .join("\n\n");
}

function buildDependencies(
  scenes: ScriptSection[],
  unitsByScene: Map<string, TapeUnit[]>,
  knownNames: string[],
  kb: ProjectKnowledgeBase,
  markdown: string
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const idx = new Map(scenes.map((s, i) => [s.section_id, i]));
  const firstAppearance = new Map<string, string>();
  const namesByScene = new Map<string, string[]>();

  for (const sec of scenes) {
    const allText = narratorText(sec) + "\n" + (unitsByScene.get(sec.section_id) || []).map((u) => u.quote_text).join("\n");
    // A person "appears" when named OR heard as a tape voice (e.g. Urs is heard in CH_01 before being named).
    const voices = (unitsByScene.get(sec.section_id) || []).flatMap((u) => u.speakers);
    const names = uniq([...findNamesInText(allText, knownNames, kb), ...voices]);
    namesByScene.set(sec.section_id, findNamesInText(narratorText(sec), knownNames, kb));
    for (const n of names) if (!firstAppearance.has(n)) firstAppearance.set(n, sec.section_id);
  }

  const push = (e: Omit<DependencyEdge, "id">) => {
    const id = `${e.kind}:${e.from_scene_id}->${e.to_scene_id}:${contentHash(e.evidence).slice(0, 6)}`;
    if (!edges.some((x) => x.id === id)) edges.push({ id, ...e });
  };

  scenes.forEach((sec, si) => {
    const narrBlocks = sec.blocks.filter((b) => b.type === "narrator");
    for (const nb of narrBlocks) {
      const text = stripNarratorTag(nb.rawText);
      let lastName: string | null = null;
      for (const sentence of splitSentences(text)) {
        const sentNames = findNamesInText(sentence, knownNames, kb).filter((n) => n !== kb.narrator_name);
        if (/\b(?:in|at) the (?:opening|beginning)\b|\byou heard in the opening\b/i.test(sentence) && si > 0) {
          push({ kind: "callback", from_scene_id: sec.section_id, to_scene_id: scenes[0].section_id, evidence: sentence, block_id: nb.id });
        }
        const remember = /\bRemember\s+([A-Z][a-z]+)/.exec(sentence);
        if (remember) {
          const name = canonicalName(remember[1], kb);
          const target = firstAppearance.get(name);
          if (target && (idx.get(target) ?? si) < si) {
            push({ kind: "callback", from_scene_id: sec.section_id, to_scene_id: target, evidence: sentence, block_id: nb.id });
          }
        }
        const backTo = /\b(?:brings me back to|back to)\s+([A-Z][a-z]+)/.exec(sentence);
        if (backTo) {
          const name = canonicalName(backTo[1], kb);
          const titled = scenes.find((s, j) => j < si && new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(s.title));
          const target = titled?.section_id || firstAppearance.get(name);
          if (target && target !== sec.section_id) {
            push({ kind: "callback", from_scene_id: sec.section_id, to_scene_id: target, evidence: sentence, block_id: nb.id });
          }
        }
        const monthRecording = new RegExp(`\\bthat (${MONTHS}) (?:recording|remark|broadcast)\\b`).exec(sentence);
        if (monthRecording) {
          const month = monthRecording[1];
          const target = scenes.find(
            (s, j) =>
              j < si &&
              (new RegExp(`\\b${month}\\s+\\d`).test(narratorText(s)) ||
                (unitsByScene.get(s.section_id) || []).some((u) => u.cue_dates.some((d) => d.startsWith(month))))
          );
          if (target) push({ kind: "callback", from_scene_id: sec.section_id, to_scene_id: target.section_id, evidence: sentence, block_id: nb.id });
        }
        const promise = /\b(?:we'll|we will|I'll)\s+(?:return|come back|get back)\s+to\s+(her|him|them|[A-Z][a-z]+)/i.exec(sentence);
        if (promise) {
          const ref = promise[1];
          const name = /^(?:her|him|them)$/i.test(ref) ? sentNames[0] || lastName : canonicalName(ref, kb);
          if (name) {
            const later = scenes.slice(si + 1);
            const target =
              later.find((s) => new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(s.title)) ||
              later.find((s) => (namesByScene.get(s.section_id) || []).includes(name));
            if (target) push({ kind: "promise", from_scene_id: sec.section_id, to_scene_id: target.section_id, evidence: sentence, block_id: nb.id });
          }
        }
        if (FLASHBACK_RE.test(sentence) && si > 0) {
          push({ kind: "flashback", from_scene_id: sec.section_id, to_scene_id: scenes[si - 1].section_id, evidence: sentence, block_id: nb.id });
        }
        if (ORDINAL_REF_RE.test(sentence)) {
          push({ kind: "ordinal_reference", from_scene_id: sec.section_id, to_scene_id: sec.section_id, evidence: sentence, block_id: nb.id });
        }
        if (sentNames.length > 0) lastName = sentNames[sentNames.length - 1];
      }
    }
  });

  // Tape cue cross-references ("same original transcript as ARCHIVAL 02").
  const unitByNumber = new Map<number, TapeUnit>();
  for (const units of unitsByScene.values()) for (const u of units) if (u.archival_number !== null) unitByNumber.set(u.archival_number, u);
  for (const units of unitsByScene.values()) {
    for (const u of units) {
      for (const n of u.referenced_archival_numbers) {
        const ref = unitByNumber.get(n);
        if (ref) {
          push({
            kind: "tape_reference",
            from_scene_id: u.scene_id,
            to_scene_id: ref.scene_id,
            evidence: `ARCHIVAL ${u.archival_number} cue references ARCHIVAL ${n}`,
          });
        }
      }
    }
  }

  // Existing deterministic resonance analyzer (reused, not duplicated).
  try {
    const resonance = analyzeCrossChapterResonance(markdown);
    for (const item of resonance.items) {
      const from = item.early_moment.section_id;
      const to = item.later_moment.section_id;
      if (idx.has(from) && idx.has(to) && from !== to) {
        push({ kind: "resonance", from_scene_id: from, to_scene_id: to, evidence: `${item.title}: "${item.motif_phrase}"` });
      }
    }
  } catch {
    // Resonance analysis is advisory; the model remains valid without it.
  }

  // Character threads: consecutive narration appearances of each name.
  for (const name of knownNames) {
    if (name === kb.narrator_name) continue;
    const appearances = scenes.filter((s) => (namesByScene.get(s.section_id) || []).includes(name)).map((s) => s.section_id);
    for (let k = 1; k < appearances.length; k++) {
      push({ kind: "character_thread", from_scene_id: appearances[k - 1], to_scene_id: appearances[k], evidence: name });
    }
  }

  return edges;
}

// ============================================================================
// Architecture signals and roles
// ============================================================================

function classifyScenes(
  scenes: ScriptSection[],
  unitsByScene: Map<string, TapeUnit[]>,
  edges: DependencyEdge[],
  knownNames: string[],
  kb: ProjectKnowledgeBase
): SceneNode[] {
  const seenNames = new Set<string>();
  const seenDates = new Set<string>();
  const nodes: SceneNode[] = [];

  scenes.forEach((sec, i) => {
    const units = unitsByScene.get(sec.section_id) || [];
    const narr = narratorText(sec);
    const allText = narr + "\n" + units.map((u) => u.quote_text).join("\n");
    const namesHere = findNamesInText(allText, knownNames, kb);
    const narrNames = findNamesInText(narr, knownNames, kb);
    const narrDates = extractDates(narr);
    const voicesHere = uniq(units.flatMap((u) => u.speakers));
    const newNames = uniq([...namesHere, ...voicesHere]).filter((n) => !seenNames.has(n) && n !== kb.narrator_name);
    const newDates = narrDates.filter((d) => !seenDates.has(d));
    namesHere.forEach((n) => seenNames.add(n));
    voicesHere.forEach((n) => seenNames.add(n));
    narrDates.forEach((d) => seenDates.add(d));

    const escalation = uniq((allText.match(ESCALATION_RE) || []).map((m) => m.toLowerCase()));
    const docMentions = (narr.match(DOCUMENT_RE) || []).length;
    const readingUnits = units.filter((u) => u.kind === "reading").length;
    const reprises = units.filter((u) => u.reprise_of_unit_id).length;
    const inbound = edges.filter((e) => e.to_scene_id === sec.section_id && (e.kind === "callback" || e.kind === "promise" || e.kind === "resonance")).length;
    const promisePayoffs = edges.filter((e) => e.to_scene_id === sec.section_id && e.kind === "promise");
    const juxtapositions = uniq((narr.match(JUXTAPOSITION_RE) || []).map((m) => m.toLowerCase()));
    const hasFlashback = edges.some((e) => e.kind === "flashback" && e.from_scene_id === sec.section_id);
    const narrationWords = wordCount(narr);
    const tapeWords = wordCount(units.map((u) => u.quote_text).join(" "));
    const documentHeavy = readingUnits >= 2 || docMentions >= 4;

    const signals: SceneSignals = {
      narration_words: narrationWords,
      tape_words: tapeWords,
      reading_units: readingUnits,
      archival_units: units.length - readingUnits,
      document_mentions: docMentions,
      new_names: newNames,
      new_dates: newDates,
      escalation_markers: escalation,
      reprise_units: reprises,
      inbound_callbacks: inbound,
      has_flashback: hasFlashback,
      document_heavy: documentHeavy,
    };

    const reasons: string[] = [];
    const isOpening = i === 0;
    const isClosing = i === scenes.length - 1;
    const newInfo = newNames.length + newDates.length;
    let role: SceneRole;
    if (isOpening || isClosing) {
      role = "crucial_turn";
      reasons.push(isOpening ? "Opening scene: establishes the listener's first frame." : "Closing scene: final payoff and last impression.");
    } else if (promisePayoffs.length > 0) {
      role = "crucial_turn";
      reasons.push(
        `Pays off a promise made in ${uniq(promisePayoffs.map((e) => e.from_scene_id)).join(", ")} ("${promisePayoffs[0].evidence.slice(0, 80)}").`
      );
    } else if (juxtapositions.length >= 2) {
      role = "crucial_turn";
      reasons.push(`Sets statements side by side across time (${juxtapositions.slice(0, 3).join(", ")}), changing how earlier material reads.`);
    } else if (escalation.length >= 3 || (escalation.length >= 2 && newInfo >= 1)) {
      role = "crucial_turn";
      reasons.push(
        newInfo > 0
          ? `Introduces new material (${[...newNames, ...newDates].slice(0, 4).join(", ")}) alongside escalation (${escalation.slice(0, 3).join(", ")}).`
          : `The conflict escalates here (${escalation.slice(0, 4).join(", ")}).`
      );
      if (reprises > 0) reasons.push(`Reprises ${reprises} earlier tape unit(s), which may be a deliberate callback.`);
    } else if (inbound >= 2 && newInfo >= 1) {
      role = "crucial_turn";
      reasons.push(`Later scenes call back to it (${inbound} inbound links) and it adds new material.`);
    } else if ((reprises > 0 && newInfo <= 1) || (narrationWords > tapeWords * 2.5 && newInfo === 0 && tapeWords > 0)) {
      role = "pacing_drag";
      if (reprises > 0) reasons.push(`${reprises} tape unit(s) repeat audio the listener already heard.`);
      if (narrationWords > tapeWords * 2.5 && newInfo === 0) reasons.push("Narration outweighs tape with no new people or dates.");
    } else {
      role = "human_texture";
      reasons.push(newInfo > 0 ? `Develops people and relationships (${newNames.concat(newDates).slice(0, 3).join(", ")}).` : "Deepens existing relationships without new plot events.");
    }

    nodes.push({
      scene_id: sec.section_id,
      index: i,
      title: sec.title,
      content_hash: sceneContentHash(sec),
      narrator_block_ids: sec.blocks.filter((b) => b.type === "narrator").map((b) => b.id),
      tape_unit_ids: units.map((u) => u.unit_id),
      speakers: uniq(units.flatMap((u) => u.speakers)),
      names_in_narration: narrNames,
      dates_in_narration: narrDates,
      signals,
      role,
      role_basis: "deterministic_signal",
      role_reasons: reasons,
      macro_action: "keep",
      macro_reason: "",
    });
  });

  return nodes;
}

function detectBottlenecks(nodes: SceneNode[]): PacingBottleneck[] {
  const out: PacingBottleneck[] = [];
  let run: SceneNode[] = [];
  const flush = () => {
    if (run.length >= 3) {
      out.push({
        scene_ids: run.map((n) => n.scene_id),
        reason: `${run.length} consecutive scenes lean on screenshots and written messages (${run
          .map((n) => `${n.scene_id}: ${n.signals.reading_units} readings, ${n.signals.document_mentions} document mentions`)
          .join("; ")}).`,
      });
    }
    run = [];
  };
  for (const n of nodes) {
    if (n.signals.document_heavy) run.push(n);
    else flush();
  }
  flush();
  return out;
}

function assignMacroActions(nodes: SceneNode[], bottlenecks: PacingBottleneck[], units: TapeUnit[]): void {
  const unitById = new Map(units.map((u) => [u.unit_id, u]));
  for (const n of nodes) {
    const isEdge = n.index === 0 || n.index === nodes.length - 1;
    const inBottleneck = bottlenecks.find((b) => b.scene_ids.includes(n.scene_id));
    if (n.signals.has_flashback) {
      n.macro_action = "keep";
      n.macro_reason = "Deliberate flashback signposted in narration; do not reorder for chronology.";
      continue;
    }
    if (isEdge) {
      n.macro_action = "keep";
      n.macro_reason = "Structural anchor (opening or closing).";
      continue;
    }
    if (n.role === "pacing_drag") {
      if (n.signals.reprise_units > 0) {
        const repriseOf = n.tape_unit_ids
          .map((id) => unitById.get(id))
          .filter((u): u is TapeUnit => Boolean(u && u.reprise_of_unit_id))
          .map((u) => unitById.get(u.reprise_of_unit_id as string)?.scene_id)
          .filter(Boolean);
        n.macro_action = "trim";
        n.macro_reason = `Repeats tape first heard in ${uniq(repriseOf).join(", ")}. Trim the narration around the reprise, or confirm the repetition is deliberate. The tape itself stays.`;
      } else {
        const neighbor = nodes[n.index - 1];
        n.macro_action = "merge";
        n.macro_reason = `Adds no new people or dates; consider merging into ${neighbor?.scene_id ?? "the previous scene"}.`;
      }
      continue;
    }
    if (inBottleneck && n.role !== "crucial_turn") {
      const mid = inBottleneck.scene_ids[Math.floor(inBottleneck.scene_ids.length / 2)];
      if (mid === n.scene_id) {
        n.macro_action = "move";
        n.macro_reason = `Middle of a ${inBottleneck.scene_ids.length} scene run of document-led material (${inBottleneck.scene_ids.join(", ")}). Consider moving it or interleaving a scene with live voices.`;
        continue;
      }
    }
    n.macro_action = "keep";
    n.macro_reason =
      n.role === "crucial_turn"
        ? n.signals.reprise_units > 0
          ? "Carries a story turn. Its reprised tape works as a callback; keep the reprise short and deliberate."
          : "Carries a story turn."
        : "Supports character and relationship texture.";
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Scene identity from parsed blocks, so blank-line reformatting by reassembly is not treated as a change. */
export function sceneContentHash(sec: ScriptSection): string {
  return contentHash(sec.blocks.map((b) => b.rawText.trim()).join("\n\n"));
}

export function spokenScenes(parsed: ParsedManuscript): ScriptSection[] {
  return parsed.sections.filter((s) => s.section_id !== "APPENDIX");
}

export function buildStoryModel(
  markdown: string,
  kb: ProjectKnowledgeBase,
  previous?: StoryModel | null
): StoryModel {
  const parsed = parseManuscript(markdown);
  const scenes = spokenScenes(parsed);
  const protectedBlocks = collectProtectedBlocks(parsed);
  const pidByBlockId = new Map(protectedBlocks.map((p) => [p.block_id, p.pid]));

  const unitsByScene = new Map<string, TapeUnit[]>();
  const allUnits: TapeUnit[] = [];
  for (const sec of scenes) {
    const units = extractTapeUnits(sec, pidByBlockId, kb);
    unitsByScene.set(sec.section_id, units);
    allUnits.push(...units);
  }
  markReprises(allUnits);

  const knownNames = collectKnownNames(allUnits, kb);
  const dependencies = buildDependencies(scenes, unitsByScene, knownNames, kb, markdown);
  const nodes = classifyScenes(scenes, unitsByScene, dependencies, knownNames, kb);
  const bottlenecks = detectBottlenecks(nodes);
  assignMacroActions(nodes, bottlenecks, allUnits);

  const characters: CharacterThread[] = knownNames
    .filter((n) => n !== kb.narrator_name)
    .map((name) => {
      const sceneIds = nodes
        .filter((n) => n.speakers.includes(name) || n.names_in_narration.includes(name) || n.signals.new_names.includes(name))
        .map((n) => n.scene_id);
      return {
        name,
        scene_ids: sceneIds,
        first_scene_id: sceneIds[0] || "",
        first_named_in_narration_scene_id: nodes.find((n) => n.names_in_narration.includes(name))?.scene_id || null,
        tape_unit_count: allUnits.filter((u) => u.speakers[0] === name).length,
      };
    })
    .filter((c) => c.scene_ids.length > 0);

  const versionId = manuscriptVersionId(markdown);
  const semantic: Record<string, SceneSemantic> = {};
  let changed: string[] = nodes.map((n) => n.scene_id);
  let stale: string[] = nodes.map((n) => n.scene_id);
  let listenerStaleFrom = 0;

  if (previous) {
    const prevHashById = new Map(previous.scenes.map((s) => [s.scene_id, s.content_hash]));
    const prevOrder = previous.scenes.map((s) => s.scene_id).join("|");
    const order = nodes.map((s) => s.scene_id).join("|");
    changed = nodes.filter((n) => prevHashById.get(n.scene_id) !== n.content_hash).map((n) => n.scene_id);

    // Reuse semantic analysis for any scene whose content is unchanged.
    const liveHashes = new Set(nodes.map((n) => n.content_hash));
    for (const [h, sem] of Object.entries(previous.semantic)) {
      if (liveHashes.has(h)) semantic[h] = sem;
    }

    // Dependents of changed scenes go stale too (callbacks, promises, resonance, tape references).
    const staleSet = new Set(changed);
    for (const e of dependencies) {
      if (changed.includes(e.from_scene_id) && e.kind !== "character_thread") staleSet.add(e.to_scene_id);
      if (changed.includes(e.to_scene_id) && e.kind !== "character_thread") staleSet.add(e.from_scene_id);
    }
    for (const n of nodes) if (!semantic[n.content_hash]) staleSet.add(n.scene_id);
    stale = nodes.filter((n) => staleSet.has(n.scene_id)).map((n) => n.scene_id);

    const firstChanged = nodes.findIndex((n) => changed.includes(n.scene_id));
    const firstReordered = order === prevOrder ? -1 : nodes.findIndex((n, k) => previous.scenes[k]?.scene_id !== n.scene_id);
    const candidates = [firstChanged, firstReordered].filter((x) => x >= 0);
    listenerStaleFrom = candidates.length > 0 ? Math.min(...candidates) : nodes.length;
  }

  return {
    model_schema: 1,
    project_id: kb.project_id,
    manuscript_version_id: versionId,
    parent_version_id: previous ? previous.manuscript_version_id : null,
    created_at: new Date().toISOString(),
    scenes: nodes,
    tape_units: allUnits,
    protected_blocks: protectedBlocks,
    dependencies,
    characters,
    bottlenecks,
    semantic,
    changed_scene_ids: changed,
    stale_scene_ids: stale,
    listener_stale_from_index: listenerStaleFrom,
  };
}

/** Attaches AI semantic annotations to a model (returns a new model; inputs are not mutated). */
export function attachSemantic(model: StoryModel, annotations: SceneSemantic[]): StoryModel {
  const semantic = { ...model.semantic };
  const valid = new Set(model.scenes.map((s) => s.content_hash));
  for (const a of annotations) if (valid.has(a.scene_content_hash)) semantic[a.scene_content_hash] = a;
  const stale = model.scenes.filter((s) => !semantic[s.content_hash]).map((s) => s.scene_id);
  return { ...model, semantic, stale_scene_ids: stale };
}

export function getSceneNode(model: StoryModel, sceneId: string): SceneNode | undefined {
  const norm = sceneId.toUpperCase().trim();
  return model.scenes.find((s) => s.scene_id.toUpperCase() === norm);
}

export function getDependenciesForScene(model: StoryModel, sceneId: string): DependencyEdge[] {
  return model.dependencies.filter((e) => e.from_scene_id === sceneId || e.to_scene_id === sceneId);
}

/** Compact, cheap description of the whole story used in model prompts instead of resending everything. */
export function buildStoryDigest(model: StoryModel): string {
  const lines: string[] = [];
  lines.push(`MANUSCRIPT VERSION: ${model.manuscript_version_id}`);
  lines.push(`SCENES (${model.scenes.length}, presentation order):`);
  for (const s of model.scenes) {
    const sem = model.semantic[s.content_hash];
    lines.push(
      `- ${s.scene_id} "${s.title}" | role=${s.role} (${s.role_basis}) | action=${s.macro_action} | tape=${s.tape_unit_ids.length} units (${s.signals.reading_units} written) | speakers=${s.speakers.join("/") || "none"} | new=${[...s.signals.new_names, ...s.signals.new_dates].join(", ") || "none"}${sem ? ` | purpose: ${sem.scene_purpose}` : ""}`
    );
  }
  if (model.bottlenecks.length > 0) {
    lines.push("PACING BOTTLENECKS:");
    model.bottlenecks.forEach((b) => lines.push(`- ${b.reason}`));
  }
  const keyDeps = model.dependencies.filter((d) => d.kind !== "character_thread");
  if (keyDeps.length > 0) {
    lines.push("NARRATIVE DEPENDENCIES:");
    keyDeps.slice(0, 40).forEach((d) => lines.push(`- ${d.kind}: ${d.from_scene_id} -> ${d.to_scene_id} (${d.evidence.slice(0, 110)})`));
  }
  return lines.join("\n");
}
