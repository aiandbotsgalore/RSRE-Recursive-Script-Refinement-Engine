/**
 * Narrative Report contract: a backward-compatible, structured story-level report that sits
 * alongside the existing five-category AuditorReport (which is unchanged).
 *
 * Produced by: the deterministic engine (no scores), the Gemini critic (live), or mocks (labeled simulated).
 * Consumed by: the ChatGPT writer, the Editorial Orchestrator, and the Narrative Intelligence UI.
 */

import type { ClaimBasis, StoryModel } from "./storyModel";
import type { ListenerTimeline } from "./listenerModel";
import { STRUCTURAL_OP_TYPES, type StructuralOperation } from "./structuralOps";

export type Priority = "critical" | "high" | "medium" | "low";

export interface ReportSource {
  provider_id: string;
  model: string;
  kind: "live" | "simulated" | "deterministic";
}

export interface ScoredAssessment {
  /** 0 to 100. Null when the source cannot judge (deterministic analysis never scores artistry). */
  score: number | null;
  rationale: string;
}

export interface SceneFinding {
  id: string;
  scene_id: string;
  role: "crucial_turn" | "human_texture" | "pacing_drag" | null;
  finding: string;
  basis: ClaimBasis;
  evidence_refs: string[];
  priority: Priority;
}

export interface ListenerFinding {
  id: string;
  scene_id: string;
  kind: "confusion" | "missing_context" | "fatigue" | "curiosity_gap" | "engagement";
  finding: string;
  basis: ClaimBasis;
  evidence_refs: string[];
  priority: Priority;
}

export interface CharacterObservation {
  id: string;
  character: string;
  observation: string;
  scene_ids: string[];
  basis: ClaimBasis;
}

export interface NarrativeOpportunity {
  id: string;
  description: string;
  scene_ids: string[];
  basis: ClaimBasis;
  evidence_refs: string[];
  priority: Priority;
}

export interface ProposedOperation {
  id: string;
  operation: StructuralOperation;
  rationale: string;
  affected_scene_ids: string[];
  expected_benefit: string;
  confidence: number;
  priority: Priority;
  basis: ClaimBasis;
  evidence_refs: string[];
}

export interface CriticalFailure {
  kind: "integrity" | "structural" | "factual";
  description: string;
  scene_id?: string;
}

export interface NarrativeReport {
  report_schema: "narrative-report/1";
  manuscript_version_id: string;
  source: ReportSource;
  created_at: string;
  global_assessment: {
    summary: string;
    central_question: string;
    narrative_effectiveness: ScoredAssessment;
    craftsmanship: ScoredAssessment;
  };
  scene_findings: SceneFinding[];
  listener_findings: ListenerFinding[];
  character_observations: CharacterObservation[];
  opportunities: NarrativeOpportunity[];
  proposed_operations: ProposedOperation[];
  affected_dependencies: string[];
  critical_failures: CriticalFailure[];
  confidence: { overall: number; uncertainties: string[] };
  recommended_priority: string[];
}

// ============================================================================
// Normalization of untrusted model output
// ============================================================================

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
const BASES: ClaimBasis[] = [
  "established_in_manuscript", "narrator_perspective", "interpretation", "disputed", "creative_recommendation", "deterministic_signal",
];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strArr(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === "string");
}
function prio(v: unknown): Priority {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : "medium";
}
function basis(v: unknown, fallback: ClaimBasis = "interpretation"): ClaimBasis {
  return BASES.includes(v as ClaimBasis) ? (v as ClaimBasis) : fallback;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Parses a structural operation from model output, accepting a JSON string or an object. */
export function normalizeOperation(raw: unknown, fallbackId: string): StructuralOperation | null {
  let o = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch { return null; }
  }
  const r = obj(o);
  const op = str(r.op);
  if (!STRUCTURAL_OP_TYPES.includes(op as (typeof STRUCTURAL_OP_TYPES)[number])) return null;
  const op_id = str(r.op_id) || fallbackId;
  const rationale = str(r.rationale) || undefined;
  switch (op) {
    case "keep":
      return str(r.scene_id) ? { op, op_id, scene_id: str(r.scene_id), rationale } : null;
    case "move_scene": {
      const to = num(r.to_index, 0, 999);
      return str(r.scene_id) && to !== null ? { op, op_id, scene_id: str(r.scene_id), to_index: to, rationale } : null;
    }
    case "reorder_scenes":
      return strArr(r.order).length > 0 ? { op, op_id, order: strArr(r.order), rationale } : null;
    case "move_unit": {
      const p = obj(r.position);
      const at = str(p.at);
      let position: Extract<StructuralOperation, { op: "move_unit" }>["position"];
      if (at === "scene_start" || at === "scene_end") position = { at };
      else if ((at === "before_unit" || at === "after_unit") && str(p.unit_id)) position = { at, unit_id: str(p.unit_id) };
      else return null;
      return str(r.unit_id) && str(r.to_scene_id) ? { op, op_id, unit_id: str(r.unit_id), to_scene_id: str(r.to_scene_id), position, rationale } : null;
    }
    case "merge_scenes":
      return str(r.scene_id) && str(r.into_scene_id) ? { op, op_id, scene_id: str(r.scene_id), into_scene_id: str(r.into_scene_id), rationale } : null;
    case "trim_narration":
      return str(r.scene_id) && str(r.narrator_hash)
        ? {
            op, op_id, scene_id: str(r.scene_id), narrator_hash: str(r.narrator_hash),
            replacement_markdown: str(r.replacement_markdown), delete_block: r.delete_block === true, rationale,
          }
        : null;
  }
  return null;
}

export interface NormalizeResult {
  report: NarrativeReport;
  complete: boolean;
  problems: string[];
}

/**
 * Coerces untrusted model JSON into a valid NarrativeReport. Unknown scene ids are dropped
 * (with a recorded problem) so a hallucinated reference can never reach the structural editor.
 */
export function normalizeNarrativeReport(raw: unknown, manuscriptVersionId: string, source: ReportSource, knownSceneIds: string[]): NormalizeResult {
  const r = obj(raw);
  const problems: string[] = [];
  const scenes = new Set(knownSceneIds.map((s) => s.toUpperCase()));
  const sceneOk = (id: unknown) => typeof id === "string" && scenes.has(id.toUpperCase());
  const canon = (id: string) => knownSceneIds.find((s) => s.toUpperCase() === id.toUpperCase()) || id;
  const ga = obj(r.global_assessment);
  const ne = obj(ga.narrative_effectiveness);
  const cr = obj(ga.craftsmanship);

  const sceneFindings: SceneFinding[] = arr(r.scene_findings).flatMap((x, i) => {
    const f = obj(x);
    if (!sceneOk(f.scene_id)) { problems.push(`scene_findings[${i}] references unknown scene ${String(f.scene_id)}`); return []; }
    const role = ["crucial_turn", "human_texture", "pacing_drag"].includes(str(f.role)) ? (str(f.role) as SceneFinding["role"]) : null;
    return [{ id: str(f.id) || `SF-${i + 1}`, scene_id: canon(str(f.scene_id)), role, finding: str(f.finding), basis: basis(f.basis), evidence_refs: strArr(f.evidence_refs), priority: prio(f.priority) }];
  });

  const listenerFindings: ListenerFinding[] = arr(r.listener_findings).flatMap((x, i) => {
    const f = obj(x);
    if (!sceneOk(f.scene_id)) { problems.push(`listener_findings[${i}] references unknown scene ${String(f.scene_id)}`); return []; }
    const kinds = ["confusion", "missing_context", "fatigue", "curiosity_gap", "engagement"];
    return [{ id: str(f.id) || `LF-${i + 1}`, scene_id: canon(str(f.scene_id)), kind: (kinds.includes(str(f.kind)) ? str(f.kind) : "confusion") as ListenerFinding["kind"], finding: str(f.finding), basis: basis(f.basis), evidence_refs: strArr(f.evidence_refs), priority: prio(f.priority) }];
  });

  const characters: CharacterObservation[] = arr(r.character_observations).map((x, i) => {
    const f = obj(x);
    return { id: str(f.id) || `CO-${i + 1}`, character: str(f.character), observation: str(f.observation), scene_ids: strArr(f.scene_ids).filter(sceneOk).map(canon), basis: basis(f.basis) };
  });

  const opportunities: NarrativeOpportunity[] = arr(r.opportunities).map((x, i) => {
    const f = obj(x);
    return { id: str(f.id) || `OP-${i + 1}`, description: str(f.description), scene_ids: strArr(f.scene_ids).filter(sceneOk).map(canon), basis: basis(f.basis, "creative_recommendation"), evidence_refs: strArr(f.evidence_refs), priority: prio(f.priority) };
  });

  const proposed: ProposedOperation[] = arr(r.proposed_operations).flatMap((x, i) => {
    const f = obj(x);
    const op = normalizeOperation(f.operation ?? f.operation_json, `PO-${i + 1}`);
    if (!op) { problems.push(`proposed_operations[${i}] is not a valid structural operation`); return []; }
    return [{
      id: str(f.id) || `PO-${i + 1}`, operation: op, rationale: str(f.rationale), affected_scene_ids: strArr(f.affected_scene_ids).filter(sceneOk).map(canon),
      expected_benefit: str(f.expected_benefit), confidence: num(f.confidence, 0, 1) ?? 0.5, priority: prio(f.priority), basis: basis(f.basis, "creative_recommendation"), evidence_refs: strArr(f.evidence_refs),
    }];
  });

  const failures: CriticalFailure[] = arr(r.critical_failures).map((x) => {
    const f = obj(x);
    const kind = ["integrity", "structural", "factual"].includes(str(f.kind)) ? (str(f.kind) as CriticalFailure["kind"]) : "structural";
    return { kind, description: str(f.description), scene_id: sceneOk(f.scene_id) ? canon(str(f.scene_id)) : undefined };
  });

  const narrScore = num(ne.score, 0, 100);
  const craftScore = num(cr.score, 0, 100);
  const conf = obj(r.confidence);
  const complete = Boolean(str(ga.summary)) && (source.kind === "deterministic" || (narrScore !== null && craftScore !== null));
  if (!complete) problems.push("Report is missing a summary or one of the two required scores.");

  return {
    complete,
    problems,
    report: {
      report_schema: "narrative-report/1",
      manuscript_version_id: manuscriptVersionId,
      source,
      created_at: new Date().toISOString(),
      global_assessment: {
        summary: str(ga.summary),
        central_question: str(ga.central_question),
        narrative_effectiveness: { score: narrScore, rationale: str(ne.rationale) },
        craftsmanship: { score: craftScore, rationale: str(cr.rationale) },
      },
      scene_findings: sceneFindings,
      listener_findings: listenerFindings,
      character_observations: characters,
      opportunities,
      proposed_operations: proposed,
      affected_dependencies: strArr(r.affected_dependencies),
      critical_failures: failures,
      confidence: { overall: num(conf.overall, 0, 1) ?? 0.5, uncertainties: strArr(conf.uncertainties) },
      recommended_priority: strArr(r.recommended_priority),
    },
  };
}

// ============================================================================
// Deterministic report (no artistic scores)
// ============================================================================

export function buildDeterministicNarrativeReport(model: StoryModel, timeline: ListenerTimeline): NarrativeReport {
  const sceneFindings: SceneFinding[] = model.scenes
    .filter((s) => s.role === "pacing_drag" || s.macro_action !== "keep")
    .map((s, i) => ({
      id: `DSF-${i + 1}`,
      scene_id: s.scene_id,
      role: s.role,
      finding: `${s.role_reasons.join(" ")} Recommended: ${s.macro_action}. ${s.macro_reason}`,
      basis: "deterministic_signal" as ClaimBasis,
      evidence_refs: s.tape_unit_ids.slice(0, 3),
      priority: (s.role === "pacing_drag" ? "medium" : "low") as Priority,
    }));
  for (const b of model.bottlenecks) {
    sceneFindings.push({
      id: `DSF-B${sceneFindings.length + 1}`,
      scene_id: b.scene_ids[0],
      role: null,
      finding: `Pacing bottleneck: ${b.reason}`,
      basis: "deterministic_signal",
      evidence_refs: b.scene_ids,
      priority: "medium",
    });
  }

  const listenerFindings: ListenerFinding[] = [];
  for (const st of timeline.states) {
    for (const f of st.confusion) {
      if (f.resolved_within_scene) continue;
      const later = timeline.editorial_resolutions[f.id];
      listenerFindings.push({
        id: f.id,
        scene_id: st.scene_id,
        kind: f.kind === "undated_recordings" ? "missing_context" : "confusion",
        finding:
          f.kind === "unidentified_voice"
            ? `A first-time listener hears ${f.term} on tape here without being told who is speaking${later ? `; narration names them only in ${later}` : ""}.`
            : f.kind === "unexplained_name"
            ? `"${f.term}" is mentioned on tape before the listener has been introduced${later ? `; introduced in ${later}` : "; never introduced in narration"}.`
            : f.kind === "unexplained_term"
            ? `Insider term "${f.term}" is heard (${f.heard_in}) without explanation${later ? `; explained in ${later}` : ""}.`
            : f.excerpt,
        basis: "deterministic_signal",
        evidence_refs: f.block_id ? [f.block_id] : [],
        priority: f.kind === "unidentified_voice" && later && later !== st.scene_id ? "high" : "low",
      });
    }
  }

  return {
    report_schema: "narrative-report/1",
    manuscript_version_id: model.manuscript_version_id,
    source: { provider_id: "narrative-engine", model: "deterministic", kind: "deterministic" },
    created_at: new Date().toISOString(),
    global_assessment: {
      summary: `${model.scenes.length} scenes; ${model.scenes.filter((s) => s.role === "crucial_turn").length} carry story turns, ${model.scenes.filter((s) => s.role === "pacing_drag").length} read as pacing drag by signal. ${model.bottlenecks.length} pacing bottleneck(s). ${listenerFindings.length} first-listener comprehension flags.`,
      central_question: timeline.states[0]?.primary_question?.text || "",
      narrative_effectiveness: { score: null, rationale: "Deterministic analysis does not score storytelling quality." },
      craftsmanship: { score: null, rationale: "Deterministic analysis does not score writing quality." },
    },
    scene_findings: sceneFindings,
    listener_findings: listenerFindings,
    character_observations: model.characters.map((c, i) => ({
      id: `DCO-${i + 1}`,
      character: c.name,
      observation: `Appears in ${c.scene_ids.length} scene(s); ${c.tape_unit_count} tape unit(s) in their own voice; first named in narration in ${c.first_named_in_narration_scene_id || "no scene"}.`,
      scene_ids: c.scene_ids,
      basis: "deterministic_signal" as ClaimBasis,
    })),
    opportunities: [],
    proposed_operations: [],
    affected_dependencies: model.dependencies.filter((d) => d.kind !== "character_thread").map((d) => `${d.kind}: ${d.from_scene_id} -> ${d.to_scene_id}`),
    critical_failures: [],
    confidence: { overall: 0.6, uncertainties: ["Roles and flags come from textual signals; they need editorial judgment."] },
    recommended_priority: listenerFindings.filter((f) => f.priority === "high").map((f) => f.id),
  };
}

// ============================================================================
// Response schemas
// ============================================================================

/** Gemini responseSchema (OpenAPI subset). `Type` enum values in @google/genai are these strings. */
export function geminiNarrativeReportSchema(): Record<string, unknown> {
  const S = { type: "STRING" };
  const N = { type: "NUMBER" };
  const SA = { type: "ARRAY", items: S };
  const scored = { type: "OBJECT", properties: { score: N, rationale: S }, required: ["score", "rationale"] };
  return {
    type: "OBJECT",
    properties: {
      global_assessment: {
        type: "OBJECT",
        properties: { summary: S, central_question: S, narrative_effectiveness: scored, craftsmanship: scored },
        required: ["summary", "central_question", "narrative_effectiveness", "craftsmanship"],
      },
      scene_findings: { type: "ARRAY", items: { type: "OBJECT", properties: { scene_id: S, role: S, finding: S, basis: S, evidence_refs: SA, priority: S }, required: ["scene_id", "finding", "basis", "priority"] } },
      listener_findings: { type: "ARRAY", items: { type: "OBJECT", properties: { scene_id: S, kind: S, finding: S, basis: S, evidence_refs: SA, priority: S }, required: ["scene_id", "kind", "finding", "priority"] } },
      character_observations: { type: "ARRAY", items: { type: "OBJECT", properties: { character: S, observation: S, scene_ids: SA, basis: S }, required: ["character", "observation"] } },
      opportunities: { type: "ARRAY", items: { type: "OBJECT", properties: { description: S, scene_ids: SA, basis: S, evidence_refs: SA, priority: S }, required: ["description", "priority"] } },
      proposed_operations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { operation_json: { type: "STRING", description: "A JSON-encoded StructuralOperation." }, rationale: S, affected_scene_ids: SA, expected_benefit: S, confidence: N, priority: S, basis: S, evidence_refs: SA },
          required: ["operation_json", "rationale", "expected_benefit", "priority"],
        },
      },
      critical_failures: { type: "ARRAY", items: { type: "OBJECT", properties: { kind: S, description: S, scene_id: S }, required: ["kind", "description"] } },
      confidence: { type: "OBJECT", properties: { overall: N, uncertainties: SA }, required: ["overall"] },
      recommended_priority: SA,
    },
    required: ["global_assessment", "scene_findings", "listener_findings", "proposed_operations", "critical_failures", "confidence"],
  };
}

export function geminiListenerPredictionSchema(): Record<string, unknown> {
  const S = { type: "STRING" };
  return {
    type: "OBJECT",
    properties: {
      inferred: { type: "ARRAY", items: S },
      curiosity: S,
      anticipation: S,
      emotional_investment: S,
      fatigue_risk: S,
      confusion: { type: "ARRAY", items: S },
      motivation_to_continue: S,
      primary_question: S,
    },
    required: ["inferred", "curiosity", "anticipation", "emotional_investment", "fatigue_risk", "confusion", "motivation_to_continue", "primary_question"],
  };
}

/**
 * Strict JSON Schema for the ChatGPT writer (OpenAI structured outputs: every property required,
 * additionalProperties false). Operations travel as JSON strings and are validated on receipt.
 */
export function writerProposalJsonSchema(): Record<string, unknown> {
  const s = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["no_change_required", "revise"] },
      summary: s,
      structural_operations_json: { type: "array", items: s },
      narrator_patches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { section_id: s, block_id: s, updated_narrator_markdown: s, rationale: s },
          required: ["section_id", "block_id", "updated_narrator_markdown", "rationale"],
        },
      },
      recommendation_responses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { recommendation_id: s, verdict: { type: "string", enum: ["accept", "reject", "defer"] }, reason: s },
          required: ["recommendation_id", "verdict", "reason"],
        },
      },
      expected_benefit: s,
      confidence: { type: "number" },
    },
    required: ["decision", "summary", "structural_operations_json", "narrator_patches", "recommendation_responses", "expected_benefit", "confidence"],
  };
}
