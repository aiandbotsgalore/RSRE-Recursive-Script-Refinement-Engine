/**
 * Editorial Orchestrator.
 *
 *   1. Narrative Intelligence analyzes the documentary (deterministic, free).
 *   2. The independent critic establishes a baseline (one full-context call).
 *   3. The writer evaluates findings + critic recommendations and proposes the most
 *      consequential changes, or NO CHANGE REQUIRED.
 *   4. Changes are staged on a candidate (structural operations + narrator patches), verified.
 *   5. Narrative Intelligence updates incrementally; the critic re-evaluates only what changed.
 *   6. Guards: regression rollback, score-inflation damping, cycle detection, budgets, plateau.
 *   7. Repeat until quality is met, progress plateaus, budget runs out, or the writer stops.
 *
 * The orchestrator NEVER writes the master manuscript. It returns the strongest valid candidate
 * (which may be the unchanged baseline) for the user to accept.
 */

import { applyNarratorPatches, parseManuscript, verifyCueIntegrity } from "../scriptEngine";
import { contentHash, estimateTokens, manuscriptVersionId } from "./hash";
import type { ProjectKnowledgeBase } from "./knowledgeBase";
import { buildStoryDigest, buildStoryModel, spokenScenes, type StoryModel } from "./storyModel";
import { simulateListenerTimeline, type ListenerTimeline } from "./listenerModel";
import {
  applyStructuralOperations,
  makeCandidateId,
  structuralFingerprint,
  unitLabel,
  verifyProtectedIntegrity,
  type ContinuityRisk,
  type ListenerImpact,
  type ManuscriptCandidate,
  type OperationResult,
  type StructuralOperation,
} from "./structuralOps";
import { buildDeterministicNarrativeReport, normalizeNarrativeReport, type NarrativeReport } from "./narrativeReport";
import {
  normalizeWriterProposal,
  renderCriticPrompt,
  renderWriterPrompt,
  type CriticInput,
  type CriticProvider,
  type CriticRecommendation,
  type EditableNarratorBlock,
  type ProviderIdentity,
  type WriterProposal,
  type WriterProposalInput,
  type WriterProvider,
} from "./providers";

export interface OrchestratorConfig {
  max_iterations: number;
  max_model_calls: number;
  max_estimated_tokens: number;
  narrative_threshold: number;
  craft_threshold: number;
  plateau_epsilon: number;
  plateau_patience: number;
  regression_tolerance: number;
  max_score_jump_without_structural_change: number;
  provider_retries: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  max_iterations: 3,
  max_model_calls: 8,
  max_estimated_tokens: 400_000,
  narrative_threshold: 85,
  craft_threshold: 85,
  plateau_epsilon: 1.5,
  plateau_patience: 1,
  regression_tolerance: 2,
  max_score_jump_without_structural_change: 6,
  provider_retries: 1,
};

export type StopReason =
  | "quality_met"
  | "writer_no_change_required"
  | "no_effective_change"
  | "plateau"
  | "max_iterations"
  | "budget_exhausted"
  | "provider_failure"
  | "repeated_failures"
  | "stale_base";

export type IterationVerdict =
  | "accepted_best"
  | "accepted_not_best"
  | "rejected_regression"
  | "rejected_integrity"
  | "rejected_critical_failure"
  | "rejected_cycle"
  | "no_change"
  | "provider_failure";

export interface Scores {
  narrative: number;
  craft: number;
}

export interface IterationRecord {
  iteration: number;
  base_version_id: string;
  candidate_version_id: string | null;
  writer_decision: WriterProposal["decision"] | null;
  writer_summary: string;
  recommendation_responses: WriterProposal["recommendation_responses"];
  op_results: OperationResult[];
  proposed_operations: StructuralOperation[];
  patches_applied: number;
  patches_rejected: string[];
  reported_scores: Scores | null;
  effective_scores: Scores | null;
  verdict: IterationVerdict;
  notes: string[];
  continuity_risks: ContinuityRisk[];
  listener_impact: ListenerImpact | null;
  critic_scope: "full" | "delta" | null;
}

export interface OrchestratorResult {
  run_id: string;
  started_at: string;
  finished_at: string;
  base_version_id: string;
  stop_reason: StopReason;
  stop_detail: string;
  iterations: IterationRecord[];
  deterministic_report: NarrativeReport;
  baseline_report: NarrativeReport | null;
  final_report: NarrativeReport | null;
  best: { version_id: string; scores: Scores | null; is_baseline: boolean };
  candidate: ManuscriptCandidate | null;
  calls_used: number;
  estimated_tokens_used: number;
  writer: ProviderIdentity;
  critic: ProviderIdentity;
  simulated: boolean;
  log: string[];
}

export interface OrchestratorParams {
  master_markdown: string;
  expected_base_version_id?: string;
  knowledge: ProjectKnowledgeBase;
  writer: WriterProvider;
  critic: CriticProvider;
  config?: Partial<OrchestratorConfig>;
  pinned_block_ids?: string[];
  locked_scene_ids?: string[];
  previous_model?: StoryModel | null;
  onProgress?: (message: string) => void;
}

// ============================================================================
// Digests (cheap context instead of repeated full manuscripts)
// ============================================================================

export function buildListenerDigest(timeline: ListenerTimeline): string {
  return timeline.states
    .map((s) => {
      const open = s.confusion.filter((c) => !c.resolved_within_scene).map((c) => c.term);
      return `- ${s.scene_id}: +${s.new_information_count} presented facts; voices ${s.voices_identified}/${s.voices_heard} identified${open.length ? `; unexplained: ${open.join(", ")}` : ""}${s.primary_question ? `; question (${s.primary_question.basis}): "${s.primary_question.text.slice(0, 120)}"` : ""}`;
    })
    .join("\n");
}

function sceneTexts(markdown: string, ids?: Set<string>) {
  return spokenScenes(parseManuscript(markdown))
    .filter((s) => !ids || ids.has(s.section_id))
    .map((s) => ({ scene_id: s.section_id, title: s.title, markdown: s.rawMarkdown }));
}

function editableBlocks(markdown: string, pinned: Set<string>, ids?: Set<string>): EditableNarratorBlock[] {
  return spokenScenes(parseManuscript(markdown))
    .filter((s) => !ids || ids.has(s.section_id))
    .flatMap((s) =>
      s.blocks
        .filter((b) => b.type === "narrator" && !pinned.has(b.id))
        .map((b) => ({ section_id: s.section_id, block_id: b.id, narrator_hash: contentHash(b.rawText), current_narrator_markdown: b.rawText }))
    );
}

function recommendationsFrom(report: NarrativeReport | null): CriticRecommendation[] {
  if (!report) return [];
  const recs: CriticRecommendation[] = [];
  for (const p of report.proposed_operations) {
    recs.push({ recommendation_id: p.id, kind: "structural_operation", summary: `${p.rationale} Expected benefit: ${p.expected_benefit}`, scene_ids: p.affected_scene_ids, operation: p.operation, priority: p.priority });
  }
  for (const f of report.scene_findings) recs.push({ recommendation_id: f.id, kind: "scene", summary: f.finding, scene_ids: [f.scene_id], priority: f.priority });
  for (const f of report.listener_findings) recs.push({ recommendation_id: f.id, kind: "listener", summary: f.finding, scene_ids: [f.scene_id], priority: f.priority });
  for (const o of report.opportunities) recs.push({ recommendation_id: o.id, kind: "opportunity", summary: o.description, scene_ids: o.scene_ids, priority: o.priority });
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const kindRank: Record<string, number> = { structural_operation: 0, listener: 1, scene: 2, opportunity: 3 };
  return recs.sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || kindRank[a.kind] - kindRank[b.kind]).slice(0, 16);
}

function findingsFrom(det: NarrativeReport): string[] {
  const structural = det.scene_findings.map((f) => `[structure/${f.scene_id}] ${f.finding}`);
  const listener = det.listener_findings.filter((f) => f.priority !== "low").map((f) => `[listener/${f.scene_id}] ${f.finding}`);
  const minorListener = det.listener_findings.filter((f) => f.priority === "low").slice(0, 6).map((f) => `[listener/${f.scene_id}] ${f.finding}`);
  return [...structural, ...listener, ...minorListener];
}

function scoresOf(report: NarrativeReport): Scores | null {
  const n = report.global_assessment.narrative_effectiveness.score;
  const c = report.global_assessment.craftsmanship.score;
  return n === null || c === null ? null : { narrative: n, craft: c };
}

function meetsQuality(s: Scores | null, report: NarrativeReport | null, cfg: OrchestratorConfig): boolean {
  return Boolean(s && report && s.narrative >= cfg.narrative_threshold && s.craft >= cfg.craft_threshold && report.critical_failures.length === 0);
}

// ============================================================================
// Run
// ============================================================================

export async function runEditorialOrchestration(params: OrchestratorParams): Promise<OrchestratorResult> {
  const cfg: OrchestratorConfig = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...(params.config || {}) };
  const kb = params.knowledge;
  const startedAt = new Date().toISOString();
  const master = params.master_markdown;
  const baseVersion = manuscriptVersionId(master);
  // Pins arrive as positional ids of the master; track them by content so they stay pinned after text moves.
  const pinnedIdSet = new Set(params.pinned_block_ids || []);
  const pinnedHashes = new Set(
    spokenScenes(parseManuscript(master)).flatMap((s) => s.blocks.filter((b) => pinnedIdSet.has(b.id)).map((b) => contentHash(b.rawText)))
  );
  const pinnedIdsFor = (markdown: string) =>
    new Set(
      spokenScenes(parseManuscript(markdown)).flatMap((s) => s.blocks.filter((b) => b.type === "narrator" && pinnedHashes.has(contentHash(b.rawText))).map((b) => b.id))
    );
  const log: string[] = [];
  const say = (m: string) => {
    log.push(`${new Date().toISOString()} ${m}`);
    params.onProgress?.(m);
  };
  let callsUsed = 0;
  let tokensUsed = 0;
  const iterations: IterationRecord[] = [];

  let model = buildStoryModel(master, kb, params.previous_model || null);
  let timeline = simulateListenerTimeline(master, kb, model);
  const detReport = buildDeterministicNarrativeReport(model, timeline);

  const finish = (stop: StopReason, detail: string, extra: { baseline: NarrativeReport | null; final: NarrativeReport | null; best: { markdown: string; scores: Scores | null; report: NarrativeReport | null } }): OrchestratorResult => {
    const isBaseline = manuscriptVersionId(extra.best.markdown) === baseVersion;
    let candidate: ManuscriptCandidate | null = null;
    if (!isBaseline) {
      const integrity = verifyProtectedIntegrity(master, extra.best.markdown);
      const accepted = iterations.filter((it) => it.verdict === "accepted_best" || it.verdict === "accepted_not_best");
      candidate = {
        candidate_id: makeCandidateId("run", baseVersion),
        label: `Editorial run: ${accepted.length} accepted revision(s)`,
        origin: "orchestrator",
        author: { provider_id: params.writer.identity.provider_id, kind: params.writer.identity.kind },
        base_version_id: baseVersion,
        base_markdown: master,
        markdown: extra.best.markdown,
        version_id: manuscriptVersionId(extra.best.markdown),
        // Operation history of accepted iterations (informational; rollback uses base_markdown).
        operations: accepted.flatMap((it) => it.proposed_operations.filter((op) => it.op_results.some((r) => r.op_id === op.op_id && r.status === "applied"))),
        narrator_patch_count: accepted.reduce((n, it) => n + it.patches_applied, 0),
        op_results: accepted.flatMap((it) => it.op_results),
        integrity,
        continuity_risks: accepted.flatMap((it) => it.continuity_risks),
        listener_impact: accepted.length > 0 ? accepted[accepted.length - 1].listener_impact : null,
        status: "staged",
        created_at: new Date().toISOString(),
        notes: [
          params.writer.identity.kind === "simulated" || params.critic.identity.kind === "simulated"
            ? "SIMULATED RUN: produced with mock providers, not real model judgment."
            : `Writer: ${params.writer.identity.display_name}. Critic: ${params.critic.identity.display_name}.`,
        ],
      };
    }
    say(`Stopped: ${stop} (${detail}).`);
    return {
      run_id: `run-${baseVersion.slice(3, 11)}-${Date.now().toString(36)}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      base_version_id: baseVersion,
      stop_reason: stop,
      stop_detail: detail,
      iterations,
      deterministic_report: detReport,
      baseline_report: extra.baseline,
      final_report: extra.final,
      best: { version_id: manuscriptVersionId(extra.best.markdown), scores: extra.best.scores, is_baseline: isBaseline },
      candidate,
      calls_used: callsUsed,
      estimated_tokens_used: tokensUsed,
      writer: params.writer.identity,
      critic: params.critic.identity,
      simulated: params.writer.identity.kind === "simulated" || params.critic.identity.kind === "simulated",
      log,
    };
  };

  if (params.expected_base_version_id && params.expected_base_version_id !== baseVersion) {
    return finish("stale_base", `Expected ${params.expected_base_version_id}, master is ${baseVersion}.`, { baseline: null, final: null, best: { markdown: master, scores: null, report: null } });
  }

  const budgetLeft = (nextPromptChars: number) =>
    callsUsed < cfg.max_model_calls && tokensUsed + Math.ceil(nextPromptChars / 4) + 2000 <= cfg.max_estimated_tokens;

  /** Calls a provider with one retry on failure or incomplete output. */
  async function callWithRetry<T>(label: string, promptChars: number, fn: () => Promise<unknown>, normalize: (raw: unknown) => { ok: boolean; value: T; problems: string[] }): Promise<T | null> {
    for (let attempt = 0; attempt <= cfg.provider_retries; attempt++) {
      if (!budgetLeft(promptChars)) {
        say(`${label}: budget would be exceeded; not calling.`);
        return null;
      }
      callsUsed++;
      tokensUsed += Math.ceil(promptChars / 4) + 2000;
      try {
        const raw = await fn();
        const n = normalize(raw);
        if (n.ok) {
          if (n.problems.length) say(`${label}: accepted with ${n.problems.length} dropped item(s): ${n.problems.slice(0, 3).join("; ")}`);
          return n.value;
        }
        say(`${label}: incomplete response (attempt ${attempt + 1}): ${n.problems.join("; ")}`);
      } catch (err) {
        say(`${label}: provider error (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return null;
  }

  const evaluate = async (markdown: string, scope: "full" | "delta", ids: Set<string> | undefined, m: StoryModel, t: ListenerTimeline) => {
    const input: CriticInput = {
      manuscript_version_id: m.manuscript_version_id,
      scope,
      story_digest: buildStoryDigest(m),
      listener_digest: buildListenerDigest(t),
      scenes: sceneTexts(markdown, scope === "full" ? undefined : ids),
      scene_order: m.scenes.map((s) => s.scene_id),
    };
    const chars = renderCriticPrompt(input).length;
    return callWithRetry<NarrativeReport>(`Critic (${params.critic.identity.display_name}, ${scope})`, chars, () => params.critic.evaluate(input), (raw) => {
      const n = normalizeNarrativeReport(raw, m.manuscript_version_id, { provider_id: params.critic.identity.provider_id, model: params.critic.identity.model, kind: params.critic.identity.kind }, m.scenes.map((s) => s.scene_id));
      return { ok: n.complete, value: n.report, problems: n.problems };
    });
  };

  // Step 1-2: baseline evaluation.
  say(`Narrative Intelligence: ${model.scenes.length} scenes, ${model.tape_units.length} tape units, ${model.dependencies.length} dependencies.`);
  say(`Requesting baseline evaluation from ${params.critic.identity.display_name}.`);
  const baselineReport = await evaluate(master, "full", undefined, model, timeline);
  if (!baselineReport) {
    return finish("provider_failure", "Critic could not produce a baseline evaluation.", { baseline: null, final: null, best: { markdown: master, scores: null, report: null } });
  }
  const baselineScores = scoresOf(baselineReport);
  let best = { markdown: master, scores: baselineScores, report: baselineReport as NarrativeReport | null, model, timeline };
  let current = { ...best };
  let lastReport: NarrativeReport = baselineReport;
  let evaluatedHashes = new Map(model.scenes.map((s) => [s.scene_id, s.content_hash]));
  const seenVersions = new Set<string>([baseVersion]);
  const seenFingerprints = new Set<string>([structuralFingerprint(model)]);
  let plateauCount = 0;
  let consecutiveFailures = 0;

  if (meetsQuality(baselineScores, baselineReport, cfg)) {
    return finish("quality_met", `Baseline already meets thresholds (narrative ${baselineScores?.narrative}, craft ${baselineScores?.craft}). NO CHANGE REQUIRED.`, { baseline: baselineReport, final: baselineReport, best });
  }

  for (let iter = 1; iter <= cfg.max_iterations; iter++) {
    const curVersion = manuscriptVersionId(current.markdown);
    const recs = recommendationsFrom(lastReport);
    const focus = new Set<string>(recs.flatMap((r) => r.scene_ids));
    for (const f of detReport.scene_findings) focus.add(f.scene_id);
    const fullContext = iter === 1 || focus.size === 0;
    const scope = fullContext ? undefined : focus;

    const writerInput: WriterProposalInput = {
      manuscript_version_id: curVersion,
      iteration: iter,
      story_digest: buildStoryDigest(current.model),
      listener_digest: buildListenerDigest(current.timeline),
      findings: findingsFrom(buildDeterministicNarrativeReport(current.model, current.timeline)),
      critic_recommendations: recs,
      scenes: sceneTexts(current.markdown, scope),
      editable_narrator_blocks: editableBlocks(current.markdown, pinnedIdsFor(current.markdown), scope),
      available_tape_units: current.model.tape_units.map((u) => ({ unit_id: u.unit_id, scene_id: u.scene_id, label: unitLabel(u) })),
      scene_order: current.model.scenes.map((s) => s.scene_id),
    };
    const record: IterationRecord = {
      iteration: iter, base_version_id: curVersion, candidate_version_id: null, writer_decision: null, writer_summary: "",
      recommendation_responses: [], op_results: [], proposed_operations: [], patches_applied: 0, patches_rejected: [], reported_scores: null,
      effective_scores: null, verdict: "no_change", notes: [], continuity_risks: [], listener_impact: null, critic_scope: null,
    };

    say(`Iteration ${iter}: asking ${params.writer.identity.display_name} for the most consequential improvement.`);
    const proposal = await callWithRetry<WriterProposal>(
      `Writer (${params.writer.identity.display_name})`,
      renderWriterPrompt(writerInput).length,
      () => params.writer.propose(writerInput),
      (raw) => {
        const n = normalizeWriterProposal(raw, writerInput.editable_narrator_blocks);
        return { ok: n.complete, value: n.proposal, problems: n.problems };
      }
    );
    if (!proposal) {
      record.verdict = "provider_failure";
      iterations.push(record);
      const reason = callsUsed >= cfg.max_model_calls ? "budget_exhausted" : "provider_failure";
      return finish(reason, "Writer did not return a usable proposal. Strongest valid version preserved.", { baseline: baselineReport, final: lastReport, best });
    }
    record.writer_decision = proposal.decision;
    record.writer_summary = proposal.summary;
    record.recommendation_responses = proposal.recommendation_responses;
    record.proposed_operations = proposal.structural_operations;

    if (proposal.decision === "no_change_required" || (proposal.structural_operations.length === 0 && proposal.narrator_patches.length === 0)) {
      record.verdict = "no_change";
      record.notes.push("Writer judged that no justified change remains.");
      iterations.push(record);
      return finish("writer_no_change_required", proposal.summary || "No justified improvement identified. NO CHANGE REQUIRED.", { baseline: baselineReport, final: lastReport, best });
    }

    // Stage: narration first (block ids belong to the current version), then structure.
    const pinnedNow = pinnedIdsFor(current.markdown);
    let staged = current.markdown;
    if (proposal.narrator_patches.length > 0) {
      const trimTargets = new Set(proposal.structural_operations.filter((o) => o.op === "trim_narration").map((o) => (o as { narrator_hash: string }).narrator_hash));
      const usable = proposal.narrator_patches.filter((p) => {
        const blk = writerInput.editable_narrator_blocks.find((b) => b.block_id === p.block_id);
        if (blk && trimTargets.has(blk.narrator_hash)) { record.patches_rejected.push(`${p.block_id}: also targeted by a trim operation`); return false; }
        return true;
      });
      const splice = applyNarratorPatches(staged, usable, [], pinnedNow);
      if (!verifyCueIntegrity(staged, splice.assembledMarkdown).tag_integrity) {
        record.patches_rejected.push("Narrator patches altered protected cues; all patches discarded.");
      } else {
        staged = splice.assembledMarkdown;
        record.patches_applied = splice.sectionDiffs.reduce((n, d) => n + d.narratorBlocksAfter.filter((t, k) => t.trim() !== (d.narratorBlocksBefore[k] || "").trim()).length, 0);
        record.patches_rejected.push(...splice.guardrailEvents.filter((e) => /BLOCK|SKIP|REJECT/i.test(e)));
      }
    }
    let applied: ReturnType<typeof applyStructuralOperations> | null = null;
    if (proposal.structural_operations.length > 0) {
      applied = applyStructuralOperations(staged, proposal.structural_operations, {
        expected_base_version_id: manuscriptVersionId(staged),
        pinned_block_ids: pinnedIdsFor(staged),
        locked_scene_ids: params.locked_scene_ids,
        knowledge: kb,
      });
      record.op_results = applied.op_results;
      record.continuity_risks = applied.continuity_risks;
      record.listener_impact = applied.listener_impact;
      if (applied.ok) staged = applied.markdown;
      else record.notes.push(...applied.errors);
    }

    const integrity = verifyProtectedIntegrity(master, staged);
    if (!integrity.ok) {
      record.verdict = "rejected_integrity";
      record.notes.push(`Protected content changed (missing ${integrity.missing.length}, added ${integrity.added.length}). Candidate discarded.`);
      iterations.push(record);
      if (++consecutiveFailures >= 2) return finish("repeated_failures", "Two consecutive invalid revisions.", { baseline: baselineReport, final: lastReport, best });
      continue;
    }
    const stagedVersion = manuscriptVersionId(staged);
    record.candidate_version_id = stagedVersion;
    if (stagedVersion === curVersion) {
      record.verdict = "no_change";
      record.notes.push("Proposal produced no effective change (identical text or all operations rejected).");
      iterations.push(record);
      return finish("no_effective_change", "The proposed revision did not change the manuscript.", { baseline: baselineReport, final: lastReport, best });
    }

    const stagedModel = buildStoryModel(staged, kb, current.model);
    if (seenVersions.has(stagedVersion) || (seenFingerprints.has(structuralFingerprint(stagedModel)) && structuralFingerprint(stagedModel) !== structuralFingerprint(current.model))) {
      record.verdict = "rejected_cycle";
      record.notes.push("Revision returns to an earlier version or arrangement (contradictory revision). Rejected.");
      iterations.push(record);
      if (++consecutiveFailures >= 2) return finish("repeated_failures", "Repeated contradictory revisions.", { baseline: baselineReport, final: lastReport, best });
      continue;
    }
    seenVersions.add(stagedVersion);
    seenFingerprints.add(structuralFingerprint(stagedModel));
    const stagedTimeline = simulateListenerTimeline(staged, kb, stagedModel);

    // Incremental critic scope: changed scenes plus their dependents.
    const directlyChanged = new Set(stagedModel.scenes.filter((s) => evaluatedHashes.get(s.scene_id) !== s.content_hash).map((s) => s.scene_id));
    const changed = new Set(directlyChanged);
    // Add direct narrative dependents only (callbacks, promises, resonance, flashbacks, tape references).
    for (const e of stagedModel.dependencies) {
      if (e.kind === "character_thread") continue;
      if (directlyChanged.has(e.from_scene_id)) changed.add(e.to_scene_id);
      if (directlyChanged.has(e.to_scene_id)) changed.add(e.from_scene_id);
    }
    const orderChanged = stagedModel.scenes.map((s) => s.scene_id).join("|") !== current.model.scenes.map((s) => s.scene_id).join("|");
    const scopeKind: "full" | "delta" = orderChanged || changed.size > Math.ceil(stagedModel.scenes.length / 2) ? "full" : "delta";
    record.critic_scope = scopeKind;
    say(`Iteration ${iter}: critic re-evaluates (${scopeKind}${scopeKind === "delta" ? `: ${Array.from(changed).join(", ")}` : ""}).`);
    const report = await evaluate(staged, scopeKind, changed, stagedModel, stagedTimeline);
    if (!report) {
      record.verdict = "provider_failure";
      iterations.push(record);
      return finish(callsUsed >= cfg.max_model_calls ? "budget_exhausted" : "provider_failure", "Critic did not return a usable evaluation. Strongest valid version preserved.", { baseline: baselineReport, final: lastReport, best });
    }
    evaluatedHashes = new Map(stagedModel.scenes.map((s) => [s.scene_id, s.content_hash]));
    const reported = scoresOf(report);
    record.reported_scores = reported;

    // Score-inflation damping: big jumps from small narration-only edits are capped.
    const structuralChange = (applied?.op_results || []).some((r) => r.status === "applied");
    let effective = reported;
    if (reported && current.scores && !structuralChange) {
      const cap = cfg.max_score_jump_without_structural_change;
      const dn = reported.narrative - current.scores.narrative;
      const dc = reported.craft - current.scores.craft;
      if (dn > cap || dc > cap) {
        effective = { narrative: current.scores.narrative + Math.min(dn, cap), craft: current.scores.craft + Math.min(dc, cap) };
        record.notes.push(`Score jump (+${dn.toFixed(1)} narrative, +${dc.toFixed(1)} craft) from narration-only edits was capped at +${cap} (possible inflation).`);
      }
    }
    record.effective_scores = effective;

    if (report.critical_failures.length > 0) {
      record.verdict = "rejected_critical_failure";
      record.notes.push(`Critic reported critical failures: ${report.critical_failures.map((f) => f.description).join("; ")}`);
      iterations.push(record);
      lastReport = report;
      if (++consecutiveFailures >= 2) return finish("repeated_failures", "Repeated critical failures.", { baseline: baselineReport, final: report, best });
      continue;
    }

    const regressed =
      effective && best.scores &&
      (effective.narrative < best.scores.narrative - cfg.regression_tolerance || effective.craft < best.scores.craft - cfg.regression_tolerance);
    if (regressed) {
      record.verdict = "rejected_regression";
      record.notes.push(`Regression versus strongest version (${best.scores?.narrative}/${best.scores?.craft}); reverted.`);
      iterations.push(record);
      current = { ...best };
      lastReport = report;
      if (++consecutiveFailures >= 2) return finish("repeated_failures", "Two consecutive regressions; strongest version preserved.", { baseline: baselineReport, final: report, best });
      continue;
    }

    consecutiveFailures = 0;
    const sum = (s: Scores | null) => (s ? s.narrative + s.craft : -Infinity);
    const improvement = sum(effective) - sum(best.scores);
    current = { markdown: staged, scores: effective, report, model: stagedModel, timeline: stagedTimeline };
    lastReport = report;
    if (improvement > 0) {
      best = { ...current };
      record.verdict = "accepted_best";
    } else {
      record.verdict = "accepted_not_best";
    }
    iterations.push(record);
    model = stagedModel;
    say(`Iteration ${iter}: ${record.verdict} (narrative ${effective?.narrative}, craft ${effective?.craft}).`);

    if (meetsQuality(effective, report, cfg)) {
      return finish("quality_met", `Thresholds met (narrative ${effective?.narrative} >= ${cfg.narrative_threshold}, craft ${effective?.craft} >= ${cfg.craft_threshold}).`, { baseline: baselineReport, final: report, best });
    }
    if (improvement < cfg.plateau_epsilon) {
      plateauCount++;
      if (plateauCount >= cfg.plateau_patience) {
        return finish("plateau", `Improvement ${improvement.toFixed(1)} below ${cfg.plateau_epsilon}.`, { baseline: baselineReport, final: report, best });
      }
    } else {
      plateauCount = 0;
    }
    if (callsUsed >= cfg.max_model_calls) {
      return finish("budget_exhausted", `Used ${callsUsed} of ${cfg.max_model_calls} model calls.`, { baseline: baselineReport, final: report, best });
    }
  }

  return finish("max_iterations", `Reached ${cfg.max_iterations} iterations.`, { baseline: baselineReport, final: lastReport, best });
}
