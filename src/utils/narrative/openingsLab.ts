/**
 * Alternate Openings Laboratory.
 *
 * Each gateway is a creative HYPOTHESIS expressed as structural operations on existing tape.
 * Gateways never invent narration or recordings: they reorder intact tape units inside the
 * opening scene. If a referenced recording is missing, or exists only outside the opening scene
 * (moving it would separate it from its context), the gateway is reported unavailable.
 * Any narration that depends on the old order is surfaced as a required bridge revision for
 * the writer rather than silently rewritten.
 */

import { manuscriptVersionId } from "./hash";
import type { GatewayDefinition, ProjectKnowledgeBase } from "./knowledgeBase";
import { buildStoryModel, type StoryModel, type TapeUnit } from "./storyModel";
import {
  applyStructuralOperations,
  makeCandidateId,
  unitLabel,
  type ManuscriptCandidate,
  type StructuralOperation,
} from "./structuralOps";
import { simulateListenerTimeline, type ListenerSceneState } from "./listenerModel";

export interface GatewayListenerProfile {
  opening_scene_id: string;
  first_audio: string;
  voices_before_first_narration: number;
  first_friendship_mention: string | null;
  unresolved_confusion_in_opening: number;
  confusion_terms: string[];
  opening_question: string | null;
  opening_question_basis: string | null;
}

export interface GatewayResult {
  gateway: GatewayDefinition;
  available: boolean;
  unavailable_reason: string | null;
  verified_units: Array<{ unit_id: string; label: string }>;
  operations: StructuralOperation[];
  candidate: ManuscriptCandidate | null;
  listener_profile: GatewayListenerProfile | null;
  bridge_revisions_required: Array<{ scene_id: string; block_id?: string; detail: string }>;
  basis: "deterministic_signal";
}

export interface OpeningsLabReport {
  manuscript_version_id: string;
  opening_scene_id: string;
  gateways: GatewayResult[];
  comparison_note: string;
}

function findUnitBySnippet(model: StoryModel, snippet: string): TapeUnit | undefined {
  const needle = snippet.toLowerCase().replace(/\s+/g, " ").replace(/[’]/g, "'");
  return model.tape_units.find((u) => u.quote_text.toLowerCase().replace(/\s+/g, " ").replace(/[’]/g, "'").includes(needle));
}

function profileOpening(state: ListenerSceneState | undefined, markdown: string, kb: ProjectKnowledgeBase, model: StoryModel): GatewayListenerProfile | null {
  if (!state) return null;
  const opening = model.scenes[0];
  const firstUnit = model.tape_units.find((u) => u.scene_id === opening.scene_id);
  // Count tape units before the first narrator block in the opening scene.
  const scene = model.tape_units.filter((u) => u.scene_id === opening.scene_id);
  // Block ids are positional ("PROLOGUE-B12"), so their numbers give presentation order.
  const pos = (id: string) => parseInt(id.slice(id.lastIndexOf("-B") + 2), 10);
  const firstNarratorId = opening.narrator_block_ids[0];
  const firstNarratorNum = firstNarratorId ? pos(firstNarratorId) : Infinity;
  const voicesBefore = scene.filter((u) => pos(u.block_ids[0]) < firstNarratorNum).length;
  const relationshipInTape = scene.findIndex((u) => /\bfriend(?:s|ship)?\b/i.test(u.quote_text));
  void markdown;
  void kb;
  return {
    opening_scene_id: opening.scene_id,
    first_audio: firstUnit ? `"${firstUnit.quote_text.replace(/\s+/g, " ").slice(0, 110)}"` : "(narration)",
    voices_before_first_narration: voicesBefore,
    first_friendship_mention:
      relationshipInTape >= 0 ? `Tape ${relationshipInTape + 1} of the opening` : state.relationships_presented.length > 0 ? "Opening narration" : null,
    unresolved_confusion_in_opening: state.confusion.filter((c) => !c.resolved_within_scene).length,
    confusion_terms: state.confusion.filter((c) => !c.resolved_within_scene).map((c) => c.term),
    opening_question: state.primary_question?.text || null,
    opening_question_basis: state.primary_question?.basis || null,
  };
}

export function buildOpeningsLab(markdown: string, kb: ProjectKnowledgeBase, pinnedBlockIds: Iterable<string> = []): OpeningsLabReport {
  const model = buildStoryModel(markdown, kb);
  const versionId = manuscriptVersionId(markdown);
  const opening = model.scenes[0];
  const results: GatewayResult[] = [];

  for (const gw of kb.gateways) {
    if (gw.lead_quote_snippets.length === 0) {
      const timeline = simulateListenerTimeline(markdown, kb, model);
      results.push({
        gateway: gw,
        available: true,
        unavailable_reason: null,
        verified_units: [],
        operations: [],
        candidate: null,
        listener_profile: profileOpening(timeline.states[0], markdown, kb, model),
        bridge_revisions_required: [],
        basis: "deterministic_signal",
      });
      continue;
    }

    const units: TapeUnit[] = [];
    let unavailable: string | null = null;
    for (const snippet of gw.lead_quote_snippets) {
      const u = findUnitBySnippet(model, snippet);
      if (!u) {
        unavailable = `Recording containing "${snippet}" was not found in this manuscript.`;
        break;
      }
      if (u.scene_id !== opening.scene_id) {
        unavailable = `Recording "${snippet}" lives in ${u.scene_id}; moving it into the opening would separate it from the narration that explains it there.`;
        break;
      }
      units.push(u);
    }

    if (unavailable) {
      results.push({
        gateway: gw, available: false, unavailable_reason: unavailable, verified_units: [], operations: [],
        candidate: null, listener_profile: null, bridge_revisions_required: [], basis: "deterministic_signal",
      });
      continue;
    }

    // Place the lead units at the top of the opening, preserving their given order.
    const ops: StructuralOperation[] = units.map((u, i) =>
      i === 0
        ? { op: "move_unit", op_id: `${gw.id}-${i + 1}`, unit_id: u.unit_id, to_scene_id: opening.scene_id, position: { at: "scene_start" }, rationale: gw.hypothesis }
        : { op: "move_unit", op_id: `${gw.id}-${i + 1}`, unit_id: u.unit_id, to_scene_id: opening.scene_id, position: { at: "after_unit", unit_id: units[i - 1].unit_id }, rationale: gw.hypothesis }
    );

    const applied = applyStructuralOperations(markdown, ops, {
      expected_base_version_id: versionId,
      pinned_block_ids: pinnedBlockIds,
      knowledge: kb,
    });

    const afterModel = buildStoryModel(applied.markdown, kb);
    const afterTimeline = simulateListenerTimeline(applied.markdown, kb, afterModel);
    const candidate: ManuscriptCandidate = {
      candidate_id: makeCandidateId(`gateway${gw.id}`, versionId),
      label: gw.label,
      origin: "gateway",
      author: { provider_id: "openings-lab", kind: "deterministic" },
      base_version_id: versionId,
      base_markdown: markdown,
      markdown: applied.markdown,
      version_id: applied.result_version_id,
      operations: ops,
      narrator_patch_count: 0,
      op_results: applied.op_results,
      integrity: applied.integrity,
      continuity_risks: applied.continuity_risks,
      listener_impact: applied.listener_impact,
      status: "staged",
      created_at: new Date().toISOString(),
      notes: [
        "Structural hypothesis only. No narration was written or changed.",
        ...(applied.continuity_risks.some((r) => r.requires_bridge_revision)
          ? ["Narration that depends on the old order must be revised before this opening is ready."]
          : []),
      ],
    };

    results.push({
      gateway: gw,
      available: applied.ok,
      unavailable_reason: applied.ok ? null : applied.errors.join(" "),
      verified_units: units.map((u) => ({ unit_id: u.unit_id, label: unitLabel(u) })),
      operations: ops,
      candidate: applied.ok ? candidate : null,
      listener_profile: profileOpening(afterTimeline.states[0], applied.markdown, kb, afterModel),
      bridge_revisions_required: applied.continuity_risks
        .filter((r) => r.requires_bridge_revision)
        .map((r) => ({ scene_id: r.scene_id, block_id: r.block_id, detail: r.detail })),
      basis: "deterministic_signal",
    });
  }

  return {
    manuscript_version_id: versionId,
    opening_scene_id: opening?.scene_id || "",
    gateways: results,
    comparison_note:
      "Listener profiles are deterministic counts of what the opening presents (voices, relationships, unexplained references). They are not audience measurements; use the live critic's simulated listener pass for a qualitative comparison.",
  };
}
