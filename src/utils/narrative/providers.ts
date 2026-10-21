/**
 * Provider contracts for the editorial roles.
 *   Writer (ChatGPT): story architect and lead writer. Proposes structural operations and narration.
 *   Critic (Gemini): independent editorial critic. Evaluates the manuscript and recommends changes.
 * Every provider carries an identity with `kind`, so simulated output is always labeled as simulated.
 * Input builders are pure functions so tests can prove what each role does and does not see.
 */

import type { NarratorBlockPatch } from "../scriptEngine";
import type { ListenerContext } from "./listenerModel";
import type { StructuralOperation } from "./structuralOps";
import { normalizeOperation } from "./narrativeReport";

export interface ProviderIdentity {
  provider_id: string;
  display_name: string;
  role: "writer" | "critic";
  model: string;
  kind: "live" | "simulated";
}

export interface CriticRecommendation {
  recommendation_id: string;
  kind: "structural_operation" | "scene" | "listener" | "opportunity";
  summary: string;
  scene_ids: string[];
  operation?: StructuralOperation;
  priority: string;
}

export interface EditableNarratorBlock {
  section_id: string;
  block_id: string;
  narrator_hash: string;
  current_narrator_markdown: string;
}

export interface WriterProposalInput {
  manuscript_version_id: string;
  iteration: number;
  story_digest: string;
  listener_digest: string;
  /** Prioritized: structural first, then comprehension, then craft. */
  findings: string[];
  critic_recommendations: CriticRecommendation[];
  scenes: Array<{ scene_id: string; title: string; markdown: string }>;
  editable_narrator_blocks: EditableNarratorBlock[];
  available_tape_units: Array<{ unit_id: string; scene_id: string; label: string }>;
  scene_order: string[];
}

export interface WriterProposal {
  decision: "no_change_required" | "revise";
  summary: string;
  structural_operations: StructuralOperation[];
  narrator_patches: Array<NarratorBlockPatch & { rationale: string }>;
  recommendation_responses: Array<{ recommendation_id: string; verdict: "accept" | "reject" | "defer"; reason: string }>;
  expected_benefit: string;
  confidence: number;
}

/** Critic input deliberately excludes the writer's justification and all previous scores. */
export interface CriticInput {
  manuscript_version_id: string;
  scope: "full" | "delta";
  story_digest: string;
  listener_digest: string;
  scenes: Array<{ scene_id: string; title: string; markdown: string }>;
  scene_order: string[];
}

export interface WriterProvider {
  identity: ProviderIdentity;
  propose(input: WriterProposalInput): Promise<unknown>;
}

export interface CriticProvider {
  identity: ProviderIdentity;
  evaluate(input: CriticInput): Promise<unknown>;
  predictListener?(context: ListenerContext): Promise<unknown>;
}

// ============================================================================
// Prompt rendering (pure)
// ============================================================================

export function renderWriterPrompt(input: WriterProposalInput): string {
  return [
    `MANUSCRIPT VERSION: ${input.manuscript_version_id} (iteration ${input.iteration})`,
    `CURRENT SCENE ORDER: ${input.scene_order.join(", ")}`,
    "",
    "NARRATIVE INTELLIGENCE (whole-story model):",
    input.story_digest,
    "",
    "FIRST-TIME LISTENER STATE (presented information only):",
    input.listener_digest,
    "",
    "PRIORITIZED FINDINGS (structural first):",
    ...input.findings.map((f, i) => `${i + 1}. ${f}`),
    "",
    "INDEPENDENT CRITIC RECOMMENDATIONS (evaluate each critically; accept, reject, or defer with a reason):",
    ...(input.critic_recommendations.length > 0
      ? input.critic_recommendations.map((r) => `- [${r.recommendation_id}] (${r.priority}, ${r.kind}) ${r.summary}${r.operation ? ` | proposed operation: ${JSON.stringify(r.operation)}` : ""}`)
      : ["(none yet)"]),
    "",
    "TAPE UNITS YOU MAY REPOSITION (intact, by unit_id; never edit their text):",
    ...input.available_tape_units.map((u) => `- ${u.unit_id} | ${u.scene_id} | ${u.label}`),
    "",
    "EDITABLE NARRATOR BLOCKS (section_id, block_id, narrator_hash):",
    ...input.editable_narrator_blocks.map((b) => `--- ${b.section_id} ${b.block_id} hash=${b.narrator_hash}\n${b.current_narrator_markdown}`),
    "",
    "SCENE TEXT FOR CONTEXT (read only):",
    ...input.scenes.map((s) => `===== ${s.scene_id}: ${s.title} =====\n${s.markdown}`),
  ].join("\n");
}

export function renderCriticPrompt(input: CriticInput): string {
  return [
    `MANUSCRIPT VERSION: ${input.manuscript_version_id}`,
    `REVIEW SCOPE: ${input.scope === "full" ? "complete manuscript" : "changed scenes and their dependents; the digest summarizes the rest"}`,
    `SCENE ORDER: ${input.scene_order.join(", ")}`,
    "",
    "STORY DIGEST:",
    input.story_digest,
    "",
    "FIRST-TIME LISTENER STATE (presented information only):",
    input.listener_digest,
    "",
    "MANUSCRIPT SCENES:",
    ...input.scenes.map((s) => `===== ${s.scene_id}: ${s.title} =====\n${s.markdown}`),
  ].join("\n");
}

export function renderListenerPrompt(ctx: ListenerContext): string {
  return [
    `YOU ARE: ${ctx.persona}`,
    `You are about to hear scene ${ctx.scene_index + 1}. You know ONLY what is below.`,
    "",
    "WHAT YOU KNOW SO FAR:",
    `- People you have been introduced to: ${ctx.prior_knowledge.known_names.join(", ") || "nobody yet"}`,
    `- Context that has been explained: ${ctx.prior_knowledge.explained_terms.join(", ") || "nothing yet"}`,
    `- Relationships you have been told about: ${ctx.prior_knowledge.relationships.join("; ") || "none yet"}`,
    `- Threads the narrator promised to return to: ${ctx.prior_knowledge.open_threads.join(" | ") || "none"}`,
    `- Questions you had after earlier scenes: ${ctx.prior_knowledge.previous_questions.join(" | ") || "none"}`,
    "",
    ctx.previous_scene_audio ? `THE END OF THE PREVIOUS SCENE, AS YOU HEARD IT:\n${ctx.previous_scene_audio}\n` : "",
    "THE SCENE YOU NOW HEAR:",
    ctx.current_scene_audio,
  ].join("\n");
}

// ============================================================================
// Writer output normalization
// ============================================================================

export interface WriterNormalizeResult {
  proposal: WriterProposal;
  complete: boolean;
  problems: string[];
}

export function normalizeWriterProposal(raw: unknown, editable: EditableNarratorBlock[]): WriterNormalizeResult {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const problems: string[] = [];
  const decision = r.decision === "revise" ? "revise" : r.decision === "no_change_required" ? "no_change_required" : null;
  if (!decision) problems.push("Missing decision.");

  const opsRaw = Array.isArray(r.structural_operations_json) ? r.structural_operations_json : Array.isArray(r.structural_operations) ? r.structural_operations : [];
  const ops: StructuralOperation[] = [];
  opsRaw.forEach((o, i) => {
    const op = normalizeOperation(o, `W-${i + 1}`);
    if (op) ops.push(op);
    else problems.push(`structural_operations[${i}] is invalid and was dropped.`);
  });

  const editableById = new Map(editable.map((b) => [b.block_id.toUpperCase(), b]));
  const patches: WriterProposal["narrator_patches"] = [];
  (Array.isArray(r.narrator_patches) ? r.narrator_patches : []).forEach((p: unknown, i: number) => {
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const target = editableById.get(String(o.block_id || "").toUpperCase());
    const text = typeof o.updated_narrator_markdown === "string" ? o.updated_narrator_markdown.trim() : "";
    if (!target || !text) { problems.push(`narrator_patches[${i}] targets an unknown or non-editable block.`); return; }
    if (text === target.current_narrator_markdown.trim()) return; // identical: not a change
    patches.push({
      section_id: target.section_id,
      block_id: target.block_id,
      updated_narrator_markdown: /^\s*\[/.test(text) ? text : `[Male Narrator]\n${text}`,
      rationale: typeof o.rationale === "string" ? o.rationale : "",
    });
  });

  const responses = (Array.isArray(r.recommendation_responses) ? r.recommendation_responses : [])
    .map((x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => typeof x.recommendation_id === "string")
    .map((x) => ({
      recommendation_id: String(x.recommendation_id),
      verdict: (x.verdict === "accept" || x.verdict === "reject" ? x.verdict : "defer") as "accept" | "reject" | "defer",
      reason: typeof x.reason === "string" ? x.reason : "",
    }));

  return {
    complete: decision !== null,
    problems,
    proposal: {
      decision: decision || "no_change_required",
      summary: typeof r.summary === "string" ? r.summary : "",
      structural_operations: ops,
      narrator_patches: patches,
      recommendation_responses: responses,
      expected_benefit: typeof r.expected_benefit === "string" ? r.expected_benefit : "",
      confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
    },
  };
}

// ============================================================================
// Mock providers (for tests and the clearly labeled simulation mode)
// ============================================================================

export function createScriptedWriter(
  responder: (input: WriterProposalInput, callNumber: number) => unknown,
  identity: Partial<ProviderIdentity> = {}
): WriterProvider & { calls: WriterProposalInput[] } {
  const calls: WriterProposalInput[] = [];
  return {
    calls,
    identity: { provider_id: "mock-writer", display_name: "Simulated writer (mock)", role: "writer", model: "mock", kind: "simulated", ...identity },
    async propose(input) {
      calls.push(input);
      return responder(input, calls.length);
    },
  };
}

export function createScriptedCritic(
  responder: (input: CriticInput, callNumber: number) => unknown,
  identity: Partial<ProviderIdentity> = {}
): CriticProvider & { calls: CriticInput[] } {
  const calls: CriticInput[] = [];
  return {
    calls,
    identity: { provider_id: "mock-critic", display_name: "Simulated critic (mock)", role: "critic", model: "mock", kind: "simulated", ...identity },
    async evaluate(input) {
      calls.push(input);
      return responder(input, calls.length);
    },
  };
}
