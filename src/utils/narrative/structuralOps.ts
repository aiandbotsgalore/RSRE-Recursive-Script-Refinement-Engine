/**
 * Structural Story Editing: Keep, Move, Merge, Trim, Reorder.
 *
 * Distinguishes REPOSITIONING an intact protected block (allowed, verified) from MODIFYING
 * protected content (never allowed). Archival quotes, cue headers, and production cues are
 * identified by content hash; after every operation the multiset of protected blocks must be
 * identical (no deletion, duplication, or alteration) and every tape unit must still be contiguous
 * with its speaker cue and cut directions.
 *
 * Reversibility: a candidate always carries the exact base manuscript text, so rollback never
 * depends on reconstructing anything from AI output.
 */

import {
  parseManuscript,
  type ParsedManuscript,
  type ScriptBlock,
  type ScriptSection,
} from "../scriptEngine";
import { contentHash, manuscriptVersionId } from "./hash";
import type { ProjectKnowledgeBase } from "./knowledgeBase";
import { buildStoryModel, collectProtectedBlocks, protectedKindOf, type StoryModel, type TapeUnit } from "./storyModel";
import { simulateListenerTimeline, type LoreFlag } from "./listenerModel";

// ============================================================================
// Operation contract
// ============================================================================

export type UnitPosition =
  | { at: "scene_start" }
  | { at: "scene_end" }
  | { at: "before_unit"; unit_id: string }
  | { at: "after_unit"; unit_id: string };

export type StructuralOperation =
  | { op: "keep"; op_id: string; scene_id: string; rationale?: string }
  | { op: "move_scene"; op_id: string; scene_id: string; to_index: number; rationale?: string }
  | { op: "reorder_scenes"; op_id: string; order: string[]; rationale?: string }
  | { op: "move_unit"; op_id: string; unit_id: string; to_scene_id: string; position: UnitPosition; rationale?: string }
  | { op: "merge_scenes"; op_id: string; scene_id: string; into_scene_id: string; rationale?: string }
  | {
      op: "trim_narration";
      op_id: string;
      scene_id: string;
      /** contentHash of the narrator block text being trimmed (stable across moves). */
      narrator_hash: string;
      replacement_markdown: string;
      /** Must be true to remove a narrator block entirely. Protected blocks can never be removed. */
      delete_block?: boolean;
      rationale?: string;
    };

export const STRUCTURAL_OP_TYPES = ["keep", "move_scene", "reorder_scenes", "move_unit", "merge_scenes", "trim_narration"] as const;

export interface OperationResult {
  op_id: string;
  op: StructuralOperation["op"];
  status: "applied" | "rejected" | "noop";
  detail: string;
  heading_removed?: string;
}

export interface ProtectedIntegrityReport {
  ok: boolean;
  protected_before: number;
  protected_after: number;
  missing: Array<{ kind: string; excerpt: string }>;
  added: Array<{ kind: string; excerpt: string }>;
  appendix_intact: boolean;
  preamble_intact: boolean;
}

export interface ContinuityRisk {
  kind:
    | "ordinal_reference_reordered"
    | "callback_before_setup"
    | "promise_after_payoff"
    | "flashback_detached"
    | "tape_context_separated"
    | "tape_reference_order";
  scene_id: string;
  block_id?: string;
  detail: string;
  requires_bridge_revision: boolean;
}

export interface ListenerImpact {
  confusion_before: number;
  confusion_after: number;
  flags_added: Array<Pick<LoreFlag, "kind" | "term" | "scene_id">>;
  flags_removed: Array<Pick<LoreFlag, "kind" | "term" | "scene_id">>;
  first_relationship_scene_before: string | null;
  first_relationship_scene_after: string | null;
  opening_question_before: string | null;
  opening_question_after: string | null;
}

export interface StructuralApplyResult {
  ok: boolean;
  stale: boolean;
  markdown: string;
  base_version_id: string;
  result_version_id: string;
  op_results: OperationResult[];
  integrity: ProtectedIntegrityReport;
  cohesion_breaks: string[];
  continuity_risks: ContinuityRisk[];
  listener_impact: ListenerImpact | null;
  errors: string[];
}

export interface StructuralApplyOptions {
  /** Optimistic concurrency: must equal manuscriptVersionId(baseMarkdown). */
  expected_base_version_id?: string;
  /** Positional narrator block ids pinned by the user in the base version. */
  pinned_block_ids?: Iterable<string>;
  /** Scenes the user locked; their contents cannot be merged, trimmed, or emptied. */
  locked_scene_ids?: Iterable<string>;
  /** Skip the listener re-simulation (faster, used in tight loops). */
  skip_listener_impact?: boolean;
  knowledge: ProjectKnowledgeBase;
}

// ============================================================================
// Working document
// ============================================================================

interface WorkScene {
  section: ScriptSection;
  blocks: ScriptBlock[];
}

interface WorkDoc {
  preamble: string;
  scenes: WorkScene[];
  appendix: ScriptSection | null;
}

function toWorkDoc(parsed: ParsedManuscript): WorkDoc {
  const appendix = parsed.sections.find((s) => s.section_id === "APPENDIX") || null;
  return {
    preamble: parsed.preamble,
    scenes: parsed.sections
      .filter((s) => s.section_id !== "APPENDIX")
      .map((s) => ({ section: s, blocks: [...s.blocks] })),
    appendix,
  };
}

function assembleWorkDoc(doc: WorkDoc): string {
  const parts: string[] = [];
  if (doc.preamble.trim()) parts.push(doc.preamble.trim());
  for (const sc of doc.scenes) {
    if (sc.blocks.length === 0) continue;
    parts.push(sc.blocks.map((b) => b.rawText.trim()).join("\n\n"));
  }
  if (doc.appendix) parts.push(doc.appendix.blocks.map((b) => b.rawText.trim()).join("\n\n"));
  return parts.join("\n\n").trim() + "\n";
}

function isRule(b: ScriptBlock): boolean {
  return /^(?:---|\*\*\*|___)\s*$/.test(b.rawText.trim());
}

function isHeading(b: ScriptBlock): boolean {
  return b.rawText.trim().startsWith("#");
}

function findScene(doc: WorkDoc, sceneId: string): WorkScene | undefined {
  const norm = sceneId.toUpperCase().trim();
  return doc.scenes.find((s) => s.section.section_id.toUpperCase() === norm);
}

function locateUnitBlocks(doc: WorkDoc, unit: TapeUnit, blockById: Map<string, ScriptBlock>): { scene: WorkScene; start: number; length: number } | null {
  const objs = unit.block_ids.map((id) => blockById.get(id)).filter((b): b is ScriptBlock => Boolean(b));
  if (objs.length !== unit.block_ids.length) return null;
  for (const sc of doc.scenes) {
    const start = sc.blocks.indexOf(objs[0]);
    if (start === -1) continue;
    for (let k = 0; k < objs.length; k++) if (sc.blocks[start + k] !== objs[k]) return null;
    return { scene: sc, start, length: objs.length };
  }
  return null;
}

function sceneStartIndex(sc: WorkScene, unitsInScene: TapeUnit[], blockById: Map<string, ScriptBlock>): number {
  // Before the first tape unit; if none, after the heading block(s).
  let first = Infinity;
  for (const u of unitsInScene) {
    const b = blockById.get(u.block_ids[0]);
    const idx = b ? sc.blocks.indexOf(b) : -1;
    if (idx !== -1 && idx < first) first = idx;
  }
  if (first !== Infinity) return first;
  let i = 0;
  while (i < sc.blocks.length && isHeading(sc.blocks[i])) i++;
  return i;
}

function sceneEndIndex(sc: WorkScene): number {
  let end = sc.blocks.length;
  while (end > 0 && isRule(sc.blocks[end - 1])) end--;
  return end;
}

function isNarratorReplacementSafe(text: string): string | null {
  if (/^\s*>/m.test(text)) return "Replacement contains a blockquote.";
  if (/\[(?:FINAL\s+)?ARCHIVAL\b/i.test(text)) return "Replacement contains an ARCHIVAL cue.";
  if (/\[(?:LOGAN|WRITTEN)\s+(?:READING|MESSAGE)\b/i.test(text)) return "Replacement contains a reading cue.";
  if (/^\s*#/m.test(text)) return "Replacement contains a heading.";
  return null;
}

// ============================================================================
// Verification
// ============================================================================

function protectedMultiset(markdown: string): Map<string, { count: number; kind: string; text: string }> {
  const out = new Map<string, { count: number; kind: string; text: string }>();
  for (const p of collectProtectedBlocks(parseManuscript(markdown))) {
    const key = `${p.kind}:${p.content_hash}`;
    const cur = out.get(key);
    if (cur) cur.count++;
    else out.set(key, { count: 1, kind: p.kind, text: p.text });
  }
  return out;
}

export function verifyProtectedIntegrity(beforeMarkdown: string, afterMarkdown: string): ProtectedIntegrityReport {
  const before = protectedMultiset(beforeMarkdown);
  const after = protectedMultiset(afterMarkdown);
  const missing: ProtectedIntegrityReport["missing"] = [];
  const added: ProtectedIntegrityReport["added"] = [];
  let beforeTotal = 0;
  let afterTotal = 0;
  for (const [key, v] of before) {
    beforeTotal += v.count;
    const a = after.get(key)?.count ?? 0;
    for (let k = a; k < v.count; k++) missing.push({ kind: v.kind, excerpt: v.text.slice(0, 120) });
  }
  for (const [key, v] of after) {
    afterTotal += v.count;
    const b = before.get(key)?.count ?? 0;
    for (let k = b; k < v.count; k++) added.push({ kind: v.kind, excerpt: v.text.slice(0, 120) });
  }
  const pb = parseManuscript(beforeMarkdown);
  const pa = parseManuscript(afterMarkdown);
  const appB = pb.sections.find((s) => s.section_id === "APPENDIX");
  const appA = pa.sections.find((s) => s.section_id === "APPENDIX");
  const appHash = (s?: ScriptSection) => (s ? contentHash(s.blocks.map((b) => b.rawText.trim()).join("\n\n")) : "");
  const appendixIntact = appHash(appB) === appHash(appA);
  const preambleIntact = contentHash(pb.preamble) === contentHash(pa.preamble);
  return {
    ok: missing.length === 0 && added.length === 0 && appendixIntact && preambleIntact,
    protected_before: beforeTotal,
    protected_after: afterTotal,
    missing,
    added,
    appendix_intact: appendixIntact,
    preamble_intact: preambleIntact,
  };
}

/** Every tape unit of the base must still appear as one contiguous, identically ordered run. */
export function verifyUnitCohesion(baseModel: StoryModel, afterMarkdown: string): string[] {
  const parsed = parseManuscript(afterMarkdown);
  const flat = parsed.sections.filter((s) => s.section_id !== "APPENDIX").flatMap((s) => s.blocks.map((b) => contentHash(b.rawText)));
  const baseHashByPid = new Map(baseModel.protected_blocks.map((p) => [p.pid, p.content_hash]));
  const breaks: string[] = [];
  for (const u of baseModel.tape_units) {
    const seq = u.pids.map((pid) => baseHashByPid.get(pid) || "");
    let found = false;
    for (let i = 0; i + seq.length <= flat.length && !found; i++) {
      let match = true;
      for (let k = 0; k < seq.length; k++) if (flat[i + k] !== seq[k]) { match = false; break; }
      if (match) found = true;
    }
    if (!found) breaks.push(`Tape unit ${u.archival_number !== null ? `ARCHIVAL ${u.archival_number}` : u.unit_id} (${u.scene_id}) is no longer contiguous with its cue and cut directions.`);
  }
  return breaks;
}

function unitOrderBySceneFor(model: StoryModel): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of model.scenes) out.set(s.scene_id, s.tape_unit_ids);
  return out;
}

/** Narrative continuity after a structural change, using the dependency graph of the base. */
export function detectContinuityRisks(baseModel: StoryModel, afterModel: StoryModel): ContinuityRisk[] {
  const risks: ContinuityRisk[] = [];
  const afterIdx = new Map(afterModel.scenes.map((s) => [s.scene_id, s.index]));
  const baseOrder = unitOrderBySceneFor(baseModel);
  const afterOrder = unitOrderBySceneFor(afterModel);

  for (const e of baseModel.dependencies) {
    const from = afterIdx.get(e.from_scene_id);
    const to = afterIdx.get(e.to_scene_id);
    if (e.kind === "ordinal_reference") {
      const before = (baseOrder.get(e.from_scene_id) || []).join("|");
      const after = (afterOrder.get(e.from_scene_id) || []).join("|");
      if (before !== after) {
        risks.push({
          kind: "ordinal_reference_reordered",
          scene_id: e.from_scene_id,
          block_id: e.block_id,
          detail: `Narration describes the order of recordings ("${e.evidence.slice(0, 90)}"), but that order changed. Revise this line.`,
          requires_bridge_revision: true,
        });
      }
      continue;
    }
    if (from === undefined || to === undefined) continue;
    if ((e.kind === "callback" || e.kind === "resonance") && from <= to && e.from_scene_id !== e.to_scene_id) {
      risks.push({
        kind: "callback_before_setup",
        scene_id: e.from_scene_id,
        block_id: e.block_id,
        detail: `${e.from_scene_id} calls back to ${e.to_scene_id}, which now plays later ("${e.evidence.slice(0, 80)}").`,
        requires_bridge_revision: e.kind === "callback",
      });
    }
    if (e.kind === "promise" && from >= to) {
      risks.push({
        kind: "promise_after_payoff",
        scene_id: e.from_scene_id,
        block_id: e.block_id,
        detail: `${e.from_scene_id} promises a return that ${e.to_scene_id} delivers, but the payoff now plays first.`,
        requires_bridge_revision: true,
      });
    }
    if (e.kind === "flashback" && from !== to + 1) {
      risks.push({
        kind: "flashback_detached",
        scene_id: e.from_scene_id,
        block_id: e.block_id,
        detail: `Flashback signpost ("${e.evidence.slice(0, 70)}") no longer follows ${e.to_scene_id}.`,
        requires_bridge_revision: true,
      });
    }
  }

  // Tape that depends on the audio immediately before it.
  const unitSeq = afterModel.tape_units.map((u) => u.unit_id);
  for (const u of baseModel.tape_units) {
    if (u.requires_preceding_unit) {
      const basePrev = baseModel.tape_units.find((x) => x.scene_id === u.scene_id && x.unit_index_in_scene === u.unit_index_in_scene - 1);
      const pos = unitSeq.indexOf(u.unit_id);
      if (basePrev && pos > 0 && unitSeq[pos - 1] !== basePrev.unit_id) {
        risks.push({
          kind: "tape_context_separated",
          scene_id: u.scene_id,
          detail: `ARCHIVAL ${u.archival_number} relies on the preceding recording (ARCHIVAL ${basePrev.archival_number}) for context, which no longer comes directly before it.`,
          requires_bridge_revision: true,
        });
      }
    }
    for (const n of u.referenced_archival_numbers) {
      const ref = baseModel.tape_units.find((x) => x.archival_number === n);
      if (!ref) continue;
      if (unitSeq.indexOf(ref.unit_id) > unitSeq.indexOf(u.unit_id)) {
        risks.push({
          kind: "tape_reference_order",
          scene_id: u.scene_id,
          detail: `ARCHIVAL ${u.archival_number} cue references ARCHIVAL ${n}, which now plays after it.`,
          requires_bridge_revision: false,
        });
      }
    }
  }
  return risks;
}

function computeListenerImpact(baseMarkdown: string, afterMarkdown: string, kb: ProjectKnowledgeBase): ListenerImpact {
  const before = simulateListenerTimeline(baseMarkdown, kb);
  const after = simulateListenerTimeline(afterMarkdown, kb);
  const key = (f: LoreFlag) => `${f.kind}|${f.term}`;
  const unresolved = (t: typeof before) => t.states.flatMap((s) => s.confusion.filter((c) => !c.resolved_within_scene));
  const b = unresolved(before);
  const a = unresolved(after);
  const bKeys = new Set(b.map(key));
  const aKeys = new Set(a.map(key));
  const firstRel = (t: typeof before) => t.states.find((s) => s.relationships_presented.length > 0)?.scene_id || null;
  return {
    confusion_before: b.length,
    confusion_after: a.length,
    flags_added: a.filter((f) => !bKeys.has(key(f))).map((f) => ({ kind: f.kind, term: f.term, scene_id: f.scene_id })),
    flags_removed: b.filter((f) => !aKeys.has(key(f))).map((f) => ({ kind: f.kind, term: f.term, scene_id: f.scene_id })),
    first_relationship_scene_before: firstRel(before),
    first_relationship_scene_after: firstRel(after),
    opening_question_before: before.states[0]?.primary_question?.text || null,
    opening_question_after: after.states[0]?.primary_question?.text || null,
  };
}

// ============================================================================
// Apply
// ============================================================================

export function applyStructuralOperations(
  baseMarkdown: string,
  ops: StructuralOperation[],
  options: StructuralApplyOptions
): StructuralApplyResult {
  const kb = options.knowledge;
  const baseVersion = manuscriptVersionId(baseMarkdown);
  const emptyIntegrity: ProtectedIntegrityReport = {
    ok: true, protected_before: 0, protected_after: 0, missing: [], added: [], appendix_intact: true, preamble_intact: true,
  };
  if (options.expected_base_version_id && options.expected_base_version_id !== baseVersion) {
    return {
      ok: false, stale: true, markdown: baseMarkdown, base_version_id: baseVersion, result_version_id: baseVersion,
      op_results: [], integrity: emptyIntegrity, cohesion_breaks: [], continuity_risks: [], listener_impact: null,
      errors: [`Stale analysis: operations were proposed for ${options.expected_base_version_id}, but the manuscript is now ${baseVersion}.`],
    };
  }

  const baseModel = buildStoryModel(baseMarkdown, kb);
  const parsed = parseManuscript(baseMarkdown);
  const doc = toWorkDoc(parsed);
  const blockById = new Map<string, ScriptBlock>();
  for (const sc of doc.scenes) for (const b of sc.blocks) blockById.set(b.id, b);
  const unitById = new Map(baseModel.tape_units.map((u) => [u.unit_id, u]));
  const pinned = new Set(options.pinned_block_ids || []);
  const locked = new Set(Array.from(options.locked_scene_ids || []).map((s) => s.toUpperCase()));
  const isLocked = (sceneId: string) => locked.has(sceneId.toUpperCase());
  const results: OperationResult[] = [];

  const reject = (op: StructuralOperation, detail: string) => results.push({ op_id: op.op_id, op: op.op, status: "rejected", detail });

  for (const op of ops) {
    if (!op || typeof op !== "object" || !STRUCTURAL_OP_TYPES.includes(op.op as (typeof STRUCTURAL_OP_TYPES)[number])) {
      results.push({ op_id: (op as { op_id?: string })?.op_id || "unknown", op: "keep", status: "rejected", detail: "Unknown operation type." });
      continue;
    }
    switch (op.op) {
      case "keep": {
        results.push({ op_id: op.op_id, op: op.op, status: "noop", detail: `Keep ${op.scene_id} as is.` });
        break;
      }
      case "move_scene": {
        const sc = findScene(doc, op.scene_id);
        if (!sc) { reject(op, `Scene ${op.scene_id} not found.`); break; }
        const from = doc.scenes.indexOf(sc);
        const to = Math.max(0, Math.min(doc.scenes.length - 1, Math.floor(op.to_index)));
        if (from === to) { results.push({ op_id: op.op_id, op: op.op, status: "noop", detail: "Already at that position." }); break; }
        doc.scenes.splice(from, 1);
        doc.scenes.splice(to, 0, sc);
        results.push({ op_id: op.op_id, op: op.op, status: "applied", detail: `Moved ${sc.section.section_id} from position ${from + 1} to ${to + 1}.` });
        break;
      }
      case "reorder_scenes": {
        const ids = doc.scenes.map((s) => s.section.section_id.toUpperCase());
        const order = (op.order || []).map((s) => String(s).toUpperCase());
        const sameSet = order.length === ids.length && new Set(order).size === ids.length && order.every((o) => ids.includes(o));
        if (!sameSet) { reject(op, "Reorder must list every scene exactly once."); break; }
        if (order.join("|") === ids.join("|")) { results.push({ op_id: op.op_id, op: op.op, status: "noop", detail: "Order unchanged." }); break; }
        doc.scenes = order.map((id) => doc.scenes.find((s) => s.section.section_id.toUpperCase() === id) as WorkScene);
        results.push({ op_id: op.op_id, op: op.op, status: "applied", detail: `New order: ${order.join(", ")}.` });
        break;
      }
      case "move_unit": {
        const unit = unitById.get(op.unit_id);
        if (!unit) { reject(op, `Tape unit ${op.unit_id} not found.`); break; }
        const target = findScene(doc, op.to_scene_id);
        if (!target) { reject(op, `Target scene ${op.to_scene_id} not found.`); break; }
        const loc = locateUnitBlocks(doc, unit, blockById);
        if (!loc) { reject(op, "Tape unit is no longer contiguous; refusing to split it."); break; }
        if ((isLocked(loc.scene.section.section_id) || isLocked(target.section.section_id)) && loc.scene !== target) {
          reject(op, "Cannot move tape into or out of a locked scene."); break;
        }
        const moved = loc.scene.blocks.splice(loc.start, loc.length);
        const unitsInTarget = baseModel.tape_units.filter((u) => u.unit_id !== unit.unit_id && locateUnitBlocks(doc, u, blockById)?.scene === target);
        let insertAt: number;
        const pos = op.position || { at: "scene_end" };
        if (pos.at === "scene_start") insertAt = sceneStartIndex(target, unitsInTarget, blockById);
        else if (pos.at === "scene_end") insertAt = sceneEndIndex(target);
        else {
          const anchor = unitById.get(pos.unit_id);
          const aloc = anchor ? locateUnitBlocks(doc, anchor, blockById) : null;
          if (!aloc || aloc.scene !== target) {
            loc.scene.blocks.splice(loc.start, 0, ...moved);
            reject(op, "Anchor unit not found in target scene."); break;
          }
          insertAt = pos.at === "before_unit" ? aloc.start : aloc.start + aloc.length;
        }
        target.blocks.splice(insertAt, 0, ...moved);
        results.push({
          op_id: op.op_id, op: op.op, status: "applied",
          detail: `Moved ${unit.archival_number !== null ? `ARCHIVAL ${unit.archival_number}` : "written reading"} (${moved.length} blocks, intact) to ${target.section.section_id} (${pos.at}).`,
        });
        break;
      }
      case "merge_scenes": {
        const src = findScene(doc, op.scene_id);
        const into = findScene(doc, op.into_scene_id);
        if (!src || !into) { reject(op, "Scene not found."); break; }
        if (doc.scenes.indexOf(src) !== doc.scenes.indexOf(into) + 1) { reject(op, "Can only merge a scene into the scene directly before it."); break; }
        if (isLocked(src.section.section_id) || isLocked(into.section.section_id)) { reject(op, "Cannot merge locked scenes."); break; }
        const headings = src.blocks.filter(isHeading);
        const body = src.blocks.filter((b) => !isHeading(b));
        while (into.blocks.length > 0 && isRule(into.blocks[into.blocks.length - 1])) into.blocks.pop();
        into.blocks.push(...body);
        doc.scenes.splice(doc.scenes.indexOf(src), 1);
        results.push({
          op_id: op.op_id, op: op.op, status: "applied",
          detail: `Merged ${src.section.section_id} into ${into.section.section_id}. All tape kept.`,
          heading_removed: headings.map((h) => h.rawText.trim()).join(" / "),
        });
        break;
      }
      case "trim_narration": {
        const sc = findScene(doc, op.scene_id);
        if (!sc) { reject(op, `Scene ${op.scene_id} not found.`); break; }
        if (isLocked(sc.section.section_id)) { reject(op, "Scene is locked."); break; }
        const idx = sc.blocks.findIndex((b) => b.type === "narrator" && contentHash(b.rawText) === op.narrator_hash);
        if (idx === -1) { reject(op, "Narrator block not found (it may have been edited)."); break; }
        const block = sc.blocks[idx];
        if (pinned.has(block.id)) { reject(op, "Narrator block is pinned."); break; }
        const replacement = (op.replacement_markdown || "").trim();
        if (!replacement) {
          if (!op.delete_block) { reject(op, "Empty replacement requires delete_block: true."); break; }
          sc.blocks.splice(idx, 1);
          results.push({ op_id: op.op_id, op: op.op, status: "applied", detail: `Removed narrator block in ${sc.section.section_id}.` });
          break;
        }
        const unsafe = isNarratorReplacementSafe(replacement);
        if (unsafe) { reject(op, unsafe); break; }
        if (protectedKindOf({ ...block, rawText: replacement, type: "narrator" }) !== null) { reject(op, "Replacement is not narration."); break; }
        sc.blocks[idx] = { ...block, rawText: replacement };
        results.push({ op_id: op.op_id, op: op.op, status: "applied", detail: `Trimmed narration in ${sc.section.section_id}.` });
        break;
      }
    }
  }

  const anyApplied = results.some((r) => r.status === "applied");
  const markdown = anyApplied ? assembleWorkDoc(doc) : baseMarkdown;
  const integrity = verifyProtectedIntegrity(baseMarkdown, markdown);
  const cohesion = anyApplied ? verifyUnitCohesion(baseModel, markdown) : [];
  const afterModel = anyApplied ? buildStoryModel(markdown, kb) : baseModel;
  const continuity = anyApplied ? detectContinuityRisks(baseModel, afterModel) : [];
  const impact = anyApplied && !options.skip_listener_impact ? computeListenerImpact(baseMarkdown, markdown, kb) : null;
  const errors: string[] = [];
  if (!integrity.ok) errors.push("Protected content integrity check failed.");
  if (cohesion.length > 0) errors.push(...cohesion);

  return {
    ok: integrity.ok && cohesion.length === 0,
    stale: false,
    markdown: integrity.ok && cohesion.length === 0 ? markdown : baseMarkdown,
    base_version_id: baseVersion,
    result_version_id: manuscriptVersionId(integrity.ok && cohesion.length === 0 ? markdown : baseMarkdown),
    op_results: results,
    integrity,
    cohesion_breaks: cohesion,
    continuity_risks: continuity,
    listener_impact: impact,
    errors,
  };
}

/** Structural fingerprint (scene order + tape order per scene) used to detect oscillating revisions. */
export function structuralFingerprint(model: StoryModel): string {
  return contentHash(model.scenes.map((s) => `${s.scene_id}:${s.tape_unit_ids.join(",")}`).join("|"));
}

// ============================================================================
// Staged candidates
// ============================================================================

export interface ManuscriptCandidate {
  candidate_id: string;
  label: string;
  origin: "gateway" | "orchestrator" | "user";
  author: { provider_id: string; kind: "live" | "simulated" | "deterministic" };
  base_version_id: string;
  /** Exact base text, retained for rollback. */
  base_markdown: string;
  markdown: string;
  version_id: string;
  operations: StructuralOperation[];
  narrator_patch_count: number;
  op_results: OperationResult[];
  integrity: ProtectedIntegrityReport;
  continuity_risks: ContinuityRisk[];
  listener_impact: ListenerImpact | null;
  status: "staged" | "accepted" | "rejected" | "superseded";
  created_at: string;
  notes: string[];
}

export function makeCandidateId(prefix: string, versionId: string): string {
  return `${prefix}-${versionId.slice(3, 11)}-${Date.now().toString(36)}`;
}

export interface AcceptCheck {
  ok: boolean;
  reason: string;
}

/** A candidate can only replace the master if it was built from the CURRENT master and passed integrity. */
export function checkCandidateAcceptable(candidate: ManuscriptCandidate, currentMasterMarkdown: string): AcceptCheck {
  const current = manuscriptVersionId(currentMasterMarkdown);
  if (candidate.base_version_id !== current) {
    return { ok: false, reason: `Candidate was built from ${candidate.base_version_id}; the master is now ${current}. Rebuild the candidate.` };
  }
  const integrity = verifyProtectedIntegrity(candidate.base_markdown, candidate.markdown);
  if (!integrity.ok) return { ok: false, reason: "Candidate fails protected content integrity." };
  return { ok: true, reason: "Candidate matches the current master version and passes integrity." };
}

export function unitLabel(u: TapeUnit): string {
  return `${u.archival_number !== null ? `ARCHIVAL ${String(u.archival_number).padStart(2, "0")}` : "WRITTEN"} ${u.speakers[0] || ""}: "${u.quote_text.replace(/\s+/g, " ").slice(0, 70)}"`;
}
