import { test } from "node:test";
import assert from "node:assert/strict";

import { INITIAL_MANUSCRIPT } from "../sampleManuscript";
import { parseManuscript } from "../scriptEngine";
import { contentHash, manuscriptVersionId } from "./hash";
import { PAPER_TRAIL_KNOWLEDGE, type ProjectKnowledgeBase } from "./knowledgeBase";
import { attachSemantic, buildStoryModel, buildStoryDigest, type SceneSemantic } from "./storyModel";
import {
  attachPrediction,
  buildListenerContext,
  simulateListenerTimeline,
  verifyListenerIsolation,
  type ListenerPrediction,
} from "./listenerModel";
import {
  applyStructuralOperations,
  checkCandidateAcceptable,
  verifyProtectedIntegrity,
  verifyUnitCohesion,
  type ManuscriptCandidate,
} from "./structuralOps";
import { buildOpeningsLab } from "./openingsLab";
import { buildDeterministicNarrativeReport, normalizeNarrativeReport } from "./narrativeReport";
import { createScriptedCritic, createScriptedWriter, renderCriticPrompt } from "./providers";
import { runEditorialOrchestration } from "./orchestrator";
import { EDITOR_SYSTEM_PROMPT, AUDITOR_SYSTEM_PROMPT, WRITER_ARCHITECT_SYSTEM_PROMPT, CRITIC_STORY_REVIEW_SYSTEM_PROMPT } from "../prompts";

// ============================================================================
// Fixtures
// ============================================================================

const TEST_KB: ProjectKnowledgeBase = {
  project_id: "fixture",
  title: "FIXTURE",
  narrator_name: "Logan",
  name_aliases: {},
  additional_named_people: [],
  glossary: [{ term: "receipts", pattern: "\\breceipts\\b", category: "jargon", plain_meaning: "Saved proof." }],
  gateways: [
    { id: "A", label: "Current", hypothesis: "Current draft.", lead_quote_snippets: [] },
    { id: "X", label: "Outside opening", hypothesis: "Uses tape from another scene.", lead_quote_snippets: ["I run these rooms"] },
  ],
  listener_persona: "A first-time listener.",
};

const FIXTURE = `# TEST DOC

**Host:** test

---

# PROLOGUE — THE COLD OPEN

[START ON ROOM SOUND.]

[ARCHIVAL 01 — DANA | *Test Show*, March 3, 2026 | \`a.txt\` | source window **00:01–00:05**]

> I kept every message. Every single one.

[BRIEF SILENCE.]

[LOGAN — NARRATION]

That was Dana. She was my friend once.

---

# CHAPTER ONE — THE RECEIPTS

[LOGAN]

A week later, the arguments started.

[ARCHIVAL 02 — MARCUS | *Test Show*, March 10, 2026 | \`b.txt\` | source window **00:10–00:20**]

> Dana has receipts on everybody in this room.

[LOGAN]

That was a turning point for all of us.

---

# CHAPTER TWO — WHO MARCUS IS

[LOGAN]

Marcus is a host who ran the late night rooms. People called saved screenshots receipts, which means proof you can post.

[ARCHIVAL 03 — MARCUS | *Test Show*, March 1, 2026 | \`c.txt\` | source window **00:30–00:40**]

> I run these rooms because people need somewhere to talk.

[LOGAN]

He believed in the rooms more than anyone.

---

# EPILOGUE — WHAT REMAINS

[LOGAN]

Dana still has the messages. I still have questions.

[FINAL ARCHIVAL 04 — DANA | *Test Show*, March 20, 2026 | \`d.txt\` | source window **00:50–00:55**]

> Everybody makes mistakes.

---

## Production-only review notes (not spoken)

1. Test appendix note about source windows and transcript files.
`;

function report(narrative: number, craft: number, extra: Record<string, unknown> = {}) {
  return {
    global_assessment: {
      summary: "Test summary.",
      central_question: "What happens to trust?",
      narrative_effectiveness: { score: narrative, rationale: "n" },
      craftsmanship: { score: craft, rationale: "c" },
    },
    scene_findings: [],
    listener_findings: [],
    character_observations: [],
    opportunities: [],
    proposed_operations: [],
    critical_failures: [],
    confidence: { overall: 0.6, uncertainties: [] },
    recommended_priority: [],
    ...extra,
  };
}

// ============================================================================
// Story model
// ============================================================================

test("story model derives scenes, tape units, speakers and dependencies from the manuscript (no hardcoded structure)", () => {
  const fx = buildStoryModel(FIXTURE, TEST_KB);
  assert.deepEqual(fx.scenes.map((s) => s.scene_id), ["PROLOGUE", "CH_01", "CH_02", "EPILOGUE"]);
  assert.equal(fx.tape_units.length, 4);
  assert.deepEqual(fx.tape_units.map((u) => u.speakers[0]), ["Dana", "Marcus", "Marcus", "Dana"]);
  // The trailing [BRIEF SILENCE.] cue travels with the PROLOGUE tape unit.
  assert.equal(fx.tape_units[0].block_ids.length, 3);

  const real = buildStoryModel(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  assert.equal(real.scenes.length, 12, "12 spoken scenes; the production appendix is excluded");
  assert.equal(real.protected_blocks.length, 139);
  const deps = real.dependencies.map((d) => `${d.kind}:${d.from_scene_id}->${d.to_scene_id}`);
  assert.ok(deps.includes("promise:CH_03->CH_10"), "Lynn promise in CH_03 pays off in CH_10");
  assert.ok(deps.includes("callback:CH_06->PROLOGUE"), "'the clip you heard in the opening'");
  assert.ok(deps.includes("flashback:CH_06->CH_05"));
  assert.ok(deps.includes("callback:CH_07->CH_01"), "'Remember Urs' points back to where his voice was first heard");
  assert.ok(deps.some((d) => d.startsWith("ordinal_reference:PROLOGUE")), "Prologue narration describes recording order");
  assert.deepEqual(real.bottlenecks[0].scene_ids, ["CH_04", "CH_05", "CH_06"]);
  assert.equal(real.scenes.find((s) => s.scene_id === "CH_10")?.role, "crucial_turn", "promise payoff is not pacing drag");
  assert.ok(buildStoryDigest(real).includes("promise: CH_03 -> CH_10"));
});

test("story model updates incrementally: unchanged scenes keep semantic analysis; changed scenes and dependents go stale", () => {
  const v1 = buildStoryModel(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  const semantic: SceneSemantic[] = v1.scenes.map((s) => ({
    scene_content_hash: s.content_hash, scene_id: s.scene_id, provider_id: "mock", model: "mock", kind: "simulated",
    created_at: "", scene_purpose: `purpose ${s.scene_id}`, dramatic_question: "", stakes: "", role_assessment: null,
    character_development: [], opportunities: [], confidence: 0.5,
  }));
  const annotated = attachSemantic(v1, semantic);
  assert.equal(annotated.stale_scene_ids.length, 0);

  const edited = INITIAL_MANUSCRIPT.replace("So the phrase didn't set off an alarm in my head.", "So the phrase didn't alarm me.");
  const v2 = buildStoryModel(edited, PAPER_TRAIL_KNOWLEDGE, annotated);
  assert.deepEqual(v2.changed_scene_ids, ["CH_02"]);
  assert.equal(v2.parent_version_id, v1.manuscript_version_id);
  assert.ok(v2.stale_scene_ids.includes("CH_02"));
  assert.ok(v2.stale_scene_ids.includes("CH_05"), "CH_05 depends on CH_02 (rainy day callback)");
  assert.ok(!v2.stale_scene_ids.includes("CH_09"), "unrelated scenes keep their analysis");
  assert.equal(Object.keys(v2.semantic).length, 11, "11 unchanged scenes reuse their semantic annotation");
  assert.equal(v2.listener_stale_from_index, 2);
});

// ============================================================================
// First-time listener
// ============================================================================

test("listener model records presented information progressively and flags real comprehension gaps", () => {
  const t = simulateListenerTimeline(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  const pro = t.states[0];
  assert.equal(pro.voices_heard, 7);
  assert.equal(pro.voices_identified, 7, "'That was Angela Maggard' identifies the seven cold-open clips");
  assert.ok(pro.primary_question?.text.includes("stop seeing you as a friend"));
  assert.equal(pro.primary_question?.basis, "asked_in_narration");
  const oor = pro.confusion.find((c) => c.term === "Oor");
  assert.ok(oor && !oor.resolved_within_scene, "'Orr' is heard in the first clip without introduction");
  assert.equal(t.editorial_resolutions[oor.id], "CH_03");
  const urs = t.states[1].confusion.find((c) => c.kind === "unidentified_voice" && c.term === "Urs");
  assert.ok(urs, "Urs is heard in CH_01 but never named there");
  assert.equal(t.editorial_resolutions[urs.id], "CH_07", "...yet CH_07 says 'Remember Urs'");
  assert.ok(t.states[8].terms_explained.includes("swatted"), "a speaker can explain a term on tape");
  assert.ok(t.states.every((s) => s.predicted === null), "no AI prediction is invented by the deterministic layer");
});

test("listener contexts contain no future scenes and no production metadata, for every scene", () => {
  const t = simulateListenerTimeline(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  for (let i = 0; i < t.states.length; i++) {
    const ctx = buildListenerContext(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE, i, t);
    assert.deepEqual(verifyListenerIsolation(ctx, INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE), [], `scene ${i} leaks`);
    assert.ok(!/\.txt|segments|source window|V3 locator/i.test(JSON.stringify(ctx)));
  }
  const ctx0 = buildListenerContext(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE, 0, t);
  assert.ok(ctx0.current_scene_audio.includes("UNIDENTIFIED VOICE A"), "speakers are anonymous until narration names them");
  // The isolation check itself must catch a planted leak.
  const leaked = { ...ctx0, previous_scene_audio: "I didn't weaponize the information. I sat on it until I was poked and poked and poked" };
  const v = verifyListenerIsolation(leaked, INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  assert.ok(v.some((x) => x.kind === "future_content"));
});

test("listener predictions are reused only when the scene and everything before it are unchanged", () => {
  const pred: ListenerPrediction = {
    provider_id: "mock", model: "mock", kind: "simulated", created_at: "", inferred: ["x"], curiosity: "c", anticipation: "a",
    emotional_investment: "e", fatigue_risk: "f", confusion: [], motivation_to_continue: "m", primary_question: "q", disclaimer: "Prediction, not measurement.",
  };
  const t1 = attachPrediction(simulateListenerTimeline(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE), "CH_05", pred);
  const laterEdit = INITIAL_MANUSCRIPT.replace("I've spent a lot of time on X.", "I've spent years on X.");
  assert.ok(simulateListenerTimeline(laterEdit, PAPER_TRAIL_KNOWLEDGE, null, t1).states[5].predicted, "edit after CH_05 keeps it");
  // Rewording CH_02 changes neither what the listener knows nor CH_05's input context, so the prediction stays valid.
  const wordingOnly = INITIAL_MANUSCRIPT.replace("The woman asking the questions is named Lynn.", "The woman asking the questions is named Lynn, a regular in those rooms.");
  assert.ok(simulateListenerTimeline(wordingOnly, PAPER_TRAIL_KNOWLEDGE, null, t1).states[5].predicted);
  // An earlier change to what the listener KNOWS invalidates it.
  const knowledgeEdit = INITIAL_MANUSCRIPT.replace("Some come for the UFO stories,", "Some come for the UFO stories, some hang out on Discord, which is a separate chat app,");
  const t3 = simulateListenerTimeline(knowledgeEdit, PAPER_TRAIL_KNOWLEDGE, null, t1);
  assert.ok(t3.states[1].terms_explained.includes("Discord"));
  assert.equal(t3.states[5].predicted, null, "an upstream change in listener knowledge invalidates it");
  // A change to the immediately previous scene (part of CH_05's listening context) invalidates it.
  const prevSceneEdit = INITIAL_MANUSCRIPT.replace("It wasn't neat.", "It was never neat.");
  assert.equal(simulateListenerTimeline(prevSceneEdit, PAPER_TRAIL_KNOWLEDGE, null, t1).states[5].predicted, null);
});

// ============================================================================
// Structural editing
// ============================================================================

test("structural operations reposition intact tape and pass content-identity integrity", () => {
  const model = buildStoryModel(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  const a07 = model.tape_units.find((u) => u.archival_number === 7)!;
  const res = applyStructuralOperations(
    INITIAL_MANUSCRIPT,
    [
      { op: "move_unit", op_id: "m1", unit_id: a07.unit_id, to_scene_id: "PROLOGUE", position: { at: "scene_start" } },
      { op: "reorder_scenes", op_id: "r1", order: ["PROLOGUE", "CH_01", "CH_03", "CH_02", "CH_04", "CH_05", "CH_06", "CH_07", "CH_08", "CH_09", "CH_10", "EPILOGUE"] },
    ],
    { expected_base_version_id: manuscriptVersionId(INITIAL_MANUSCRIPT), knowledge: PAPER_TRAIL_KNOWLEDGE }
  );
  assert.ok(res.ok, res.errors.join(" "));
  assert.equal(res.integrity.protected_before, 139);
  assert.equal(res.integrity.protected_after, 139);
  assert.ok(res.integrity.appendix_intact && res.integrity.preamble_intact);
  assert.deepEqual(verifyUnitCohesion(model, res.markdown), []);
  assert.ok(res.continuity_risks.some((r) => r.kind === "ordinal_reference_reordered"));
  assert.equal(parseManuscript(res.markdown).sections[2].section_id, "CH_03");
});

test("integrity verification detects modified, duplicated and deleted tape; unsafe trims are rejected", () => {
  const quote = "> There's way more screenshots than that. I'm just keeping them for a rainy day.";
  assert.ok(INITIAL_MANUSCRIPT.includes(quote));
  const modified = verifyProtectedIntegrity(INITIAL_MANUSCRIPT, INITIAL_MANUSCRIPT.replace(quote, "> There's way more screenshots than that."));
  assert.equal(modified.ok, false);
  assert.equal(modified.missing.length, 1);
  assert.equal(modified.added.length, 1);
  const duplicated = verifyProtectedIntegrity(INITIAL_MANUSCRIPT, INITIAL_MANUSCRIPT.replace(quote, `${quote}\n\n${quote.replace("rainy", "rainy")}\n\n[HARD CUT.]\n\n${quote}`));
  assert.equal(duplicated.ok, false);
  const deleted = verifyProtectedIntegrity(INITIAL_MANUSCRIPT, INITIAL_MANUSCRIPT.replace(quote, ""));
  assert.equal(deleted.ok, false);

  const model = buildStoryModel(FIXTURE, TEST_KB);
  const narr = parseManuscript(FIXTURE).sections[1].blocks.find((b) => b.type === "narrator")!;
  const sneaky = applyStructuralOperations(FIXTURE, [
    { op: "trim_narration", op_id: "t1", scene_id: "CH_01", narrator_hash: contentHash(narr.rawText), replacement_markdown: "[LOGAN]\nA week later.\n\n> Fabricated quote." },
  ], { knowledge: TEST_KB });
  assert.equal(sneaky.op_results[0].status, "rejected");
  assert.equal(sneaky.markdown, FIXTURE);

  const locked = applyStructuralOperations(FIXTURE, [
    { op: "trim_narration", op_id: "t2", scene_id: "CH_01", narrator_hash: contentHash(narr.rawText), replacement_markdown: "[LOGAN]\nA week later." },
    { op: "move_unit", op_id: "m2", unit_id: model.tape_units[1].unit_id, to_scene_id: "CH_02", position: { at: "scene_end" } },
  ], { knowledge: TEST_KB, locked_scene_ids: ["CH_01"] });
  assert.deepEqual(locked.op_results.map((r) => r.status), ["rejected", "rejected"]);

  const pinned = applyStructuralOperations(FIXTURE, [
    { op: "trim_narration", op_id: "t3", scene_id: "CH_01", narrator_hash: contentHash(narr.rawText), replacement_markdown: "[LOGAN]\nA week later." },
  ], { knowledge: TEST_KB, pinned_block_ids: [narr.id] });
  assert.equal(pinned.op_results[0].status, "rejected");

  const stale = applyStructuralOperations(FIXTURE, [], { knowledge: TEST_KB, expected_base_version_id: "mv-00000000-0" });
  assert.equal(stale.stale, true);
});

test("merge keeps every tape block, records the removed heading, and candidates roll back to the exact base", () => {
  const res = applyStructuralOperations(FIXTURE, [{ op: "merge_scenes", op_id: "g1", scene_id: "CH_02", into_scene_id: "CH_01" }], { knowledge: TEST_KB });
  assert.ok(res.ok);
  assert.equal(res.op_results[0].status, "applied");
  assert.ok(res.op_results[0].heading_removed?.includes("WHO MARCUS IS"));
  assert.equal(buildStoryModel(res.markdown, TEST_KB).scenes.length, 3);
  assert.equal(res.integrity.protected_before, res.integrity.protected_after);

  const bad = applyStructuralOperations(FIXTURE, [{ op: "merge_scenes", op_id: "g2", scene_id: "EPILOGUE", into_scene_id: "CH_01" }], { knowledge: TEST_KB });
  assert.equal(bad.op_results[0].status, "rejected", "only adjacent scenes merge");

  const cand: ManuscriptCandidate = {
    candidate_id: "c1", label: "t", origin: "user", author: { provider_id: "u", kind: "deterministic" },
    base_version_id: manuscriptVersionId(FIXTURE), base_markdown: FIXTURE, markdown: res.markdown, version_id: res.result_version_id,
    operations: [], narrator_patch_count: 0, op_results: res.op_results, integrity: res.integrity, continuity_risks: [], listener_impact: null,
    status: "staged", created_at: "", notes: [],
  };
  assert.ok(checkCandidateAcceptable(cand, FIXTURE).ok);
  assert.equal(checkCandidateAcceptable(cand, FIXTURE + "\nedit").ok, false, "stale candidates cannot replace a newer master");
  assert.equal(cand.base_markdown, FIXTURE, "rollback restores the exact original text");
});

test("STORY-LEVEL DEMO: moving the scene that introduces Marcus ahead of his first tape removes listener confusion", () => {
  const before = simulateListenerTimeline(FIXTURE, TEST_KB);
  const ch1 = before.states[1];
  assert.ok(ch1.confusion.some((c) => c.kind === "unidentified_voice" && c.term === "Marcus"));
  assert.ok(ch1.confusion.some((c) => c.kind === "unexplained_term" && c.term === "receipts"));

  const res = applyStructuralOperations(FIXTURE, [{ op: "move_scene", op_id: "s1", scene_id: "CH_02", to_index: 1 }], {
    expected_base_version_id: manuscriptVersionId(FIXTURE), knowledge: TEST_KB,
  });
  assert.ok(res.ok);
  assert.ok(res.listener_impact);
  assert.ok(res.listener_impact.confusion_after < res.listener_impact.confusion_before);
  assert.ok(res.listener_impact.flags_removed.some((f) => f.term === "Marcus"));
  assert.ok(res.listener_impact.flags_removed.some((f) => f.term === "receipts"));
  assert.deepEqual(res.listener_impact.flags_added, []);
  const after = simulateListenerTimeline(res.markdown, TEST_KB);
  assert.equal(after.states[2].scene_id, "CH_01");
  assert.equal(after.states[2].confusion.filter((c) => !c.resolved_within_scene).length, 0);
});

// ============================================================================
// Openings laboratory
// ============================================================================

test("openings lab stages three gateways from existing tape only, verifies recordings, and flags required bridges", () => {
  const lab = buildOpeningsLab(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE);
  assert.equal(lab.gateways.length, 3);
  const [a, b, c] = lab.gateways;
  assert.equal(a.candidate, null, "Gateway A is the current draft");
  assert.ok(b.available && c.available);
  for (const g of [b, c]) {
    assert.ok(g.candidate!.integrity.ok);
    assert.equal(g.candidate!.integrity.protected_after, 139);
    assert.equal(g.candidate!.base_markdown, INITIAL_MANUSCRIPT);
    assert.ok(g.bridge_revisions_required.length >= 2, "Prologue narration describes the old recording order");
    assert.ok(g.candidate!.notes[0].includes("No narration was written"));
  }
  assert.ok(b.listener_profile!.first_audio.includes("So Logan was the second space"));
  assert.ok(c.listener_profile!.first_audio.includes("big bad wolf"));

  const fx = buildOpeningsLab(FIXTURE, TEST_KB);
  assert.equal(fx.gateways[1].available, false);
  assert.match(fx.gateways[1].unavailable_reason || "", /lives in CH_02/);
});

// ============================================================================
// Narrative report contract
// ============================================================================

test("narrative report normalizer drops hallucinated scenes and invalid operations; deterministic report never scores", () => {
  const n = normalizeNarrativeReport(
    report(80, 82, {
      scene_findings: [{ scene_id: "CH_99", finding: "x", basis: "interpretation", priority: "high" }, { scene_id: "ch_01", finding: "ok", basis: "interpretation", priority: "high" }],
      proposed_operations: [
        { operation_json: JSON.stringify({ op: "move_scene", scene_id: "CH_02", to_index: 1 }), rationale: "r", expected_benefit: "b", priority: "high" },
        { operation_json: "{not json", rationale: "r", expected_benefit: "b", priority: "low" },
      ],
    }),
    "mv-x", { provider_id: "gemini", model: "m", kind: "live" }, ["PROLOGUE", "CH_01", "CH_02", "EPILOGUE"]
  );
  assert.ok(n.complete);
  assert.equal(n.report.scene_findings.length, 1);
  assert.equal(n.report.scene_findings[0].scene_id, "CH_01");
  assert.equal(n.report.proposed_operations.length, 1);
  assert.equal(n.problems.length, 2);
  const incomplete = normalizeNarrativeReport({ global_assessment: { summary: "s" } }, "mv-x", { provider_id: "g", model: "m", kind: "live" }, []);
  assert.equal(incomplete.complete, false, "a live report without scores is incomplete");

  const det = buildDeterministicNarrativeReport(buildStoryModel(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE), simulateListenerTimeline(INITIAL_MANUSCRIPT, PAPER_TRAIL_KNOWLEDGE));
  assert.equal(det.global_assessment.narrative_effectiveness.score, null);
  assert.equal(det.source.kind, "deterministic");
  assert.ok(det.listener_findings.some((f) => f.finding.includes("Urs") && f.priority === "high"));
});

// ============================================================================
// Orchestrator
// ============================================================================

test("orchestrator: NO CHANGE REQUIRED is valid (baseline meets thresholds, writer never called)", async () => {
  const writer = createScriptedWriter(() => { throw new Error("must not be called"); });
  const critic = createScriptedCritic(() => report(92, 91));
  const r = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer, critic });
  assert.equal(r.stop_reason, "quality_met");
  assert.equal(r.candidate, null);
  assert.equal(writer.calls.length, 0);
  assert.ok(r.best.is_baseline);
  assert.ok(r.simulated, "mock runs are labeled simulated");
});

test("orchestrator: writer may decline; nothing is forced", async () => {
  const writer = createScriptedWriter(() => ({ decision: "no_change_required", summary: "Already effective.", structural_operations_json: [], narrator_patches: [], recommendation_responses: [], expected_benefit: "", confidence: 0.8 }));
  const critic = createScriptedCritic(() => report(70, 70));
  const r = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer, critic });
  assert.equal(r.stop_reason, "writer_no_change_required");
  assert.equal(r.candidate, null);
  assert.equal(r.calls_used, 2);
});

test("orchestrator: structural improvement is staged (never written to master), critic stays independent", async () => {
  const SECRET = "WRITER-JUSTIFICATION-TOKEN-7731";
  const writer = createScriptedWriter((input, n) =>
    n === 1
      ? { decision: "revise", summary: SECRET, structural_operations_json: [JSON.stringify({ op: "move_scene", op_id: "w1", scene_id: "CH_02", to_index: 1, rationale: SECRET })], narrator_patches: [], recommendation_responses: [{ recommendation_id: "PO-1", verdict: "accept", reason: SECRET }], expected_benefit: SECRET, confidence: 0.7 }
      : { decision: "no_change_required", summary: "done", structural_operations_json: [], narrator_patches: [], recommendation_responses: [], expected_benefit: "", confidence: 0.7 }
  );
  const critic = createScriptedCritic((input, n) =>
    n === 1
      ? report(70, 80, { proposed_operations: [{ operation_json: JSON.stringify({ op: "move_scene", scene_id: "CH_02", to_index: 1 }), rationale: "Introduce Marcus before his tape.", expected_benefit: "Less confusion", priority: "high" }] })
      : report(84, 81)
  );
  const master = FIXTURE;
  const r = await runEditorialOrchestration({ master_markdown: master, knowledge: TEST_KB, writer, critic, config: { narrative_threshold: 90, craft_threshold: 90 } });
  assert.equal(master, FIXTURE, "the master string is never modified");
  assert.equal(r.iterations[0].verdict, "accepted_best");
  assert.ok(r.candidate);
  assert.equal(r.candidate.base_markdown, FIXTURE);
  assert.equal(r.candidate.status, "staged");
  assert.ok(r.candidate.integrity.ok);
  assert.equal(r.candidate.operations[0].op, "move_scene");
  assert.ok(writer.calls[0].critic_recommendations.some((x) => x.kind === "structural_operation"), "critic recommendations reach the writer");
  for (const call of critic.calls) {
    const prompt = renderCriticPrompt(call);
    assert.ok(!prompt.includes(SECRET), "critic never sees the writer's justification");
    assert.ok(!/\b(?:70|80|84)\b(?:\.\d)?\s*(?:\/|points|score)/.test(prompt), "critic never sees previous scores");
  }
  assert.equal(critic.calls[0].scope, "full");
});

test("orchestrator: regressions are rejected and the strongest version is preserved", async () => {
  let moved = false;
  const writer = createScriptedWriter(() => {
    const op = moved ? { op: "move_scene", op_id: "w2", scene_id: "EPILOGUE", to_index: 2 } : { op: "move_scene", op_id: "w1", scene_id: "CH_02", to_index: 1 };
    moved = true;
    return { decision: "revise", summary: "s", structural_operations_json: [JSON.stringify(op)], narrator_patches: [], recommendation_responses: [], expected_benefit: "", confidence: 0.5 };
  });
  const scores = [report(70, 70), report(80, 80), report(72, 79), report(71, 79)];
  const critic = createScriptedCritic((_i, n) => scores[n - 1]);
  const r = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer, critic, config: { max_iterations: 3, max_model_calls: 10, narrative_threshold: 95, craft_threshold: 95 } });
  assert.equal(r.iterations[0].verdict, "accepted_best");
  assert.equal(r.iterations[1].verdict, "rejected_regression");
  assert.deepEqual(r.best.scores, { narrative: 80, craft: 80 });
  const bestOrder = buildStoryModel(r.candidate!.markdown, TEST_KB).scenes.map((s) => s.scene_id);
  assert.deepEqual(bestOrder, ["PROLOGUE", "CH_02", "CH_01", "EPILOGUE"]);
});

test("orchestrator: score inflation is damped, contradictory revisions are rejected, budgets and failures stop safely", async () => {
  // Inflation: narration-only patch with a +25 jump is capped.
  const blk = parseManuscript(FIXTURE).sections[1].blocks.find((b) => b.type === "narrator")!;
  const w1 = createScriptedWriter(() => ({ decision: "revise", summary: "", structural_operations_json: [], narrator_patches: [{ section_id: "CH_01", block_id: blk.id, updated_narrator_markdown: "[LOGAN]\nA week later, the arguments began.", rationale: "" }], recommendation_responses: [], expected_benefit: "", confidence: 0.5 }));
  const c1 = createScriptedCritic((_i, n) => (n === 1 ? report(60, 60) : report(85, 85)));
  const r1 = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer: w1, critic: c1, config: { max_iterations: 1, narrative_threshold: 99, craft_threshold: 99 } });
  assert.deepEqual(r1.iterations[0].effective_scores, { narrative: 66, craft: 66 });
  assert.ok(r1.iterations[0].notes.some((n) => n.includes("capped")));

  // Cycle: moving a scene and then moving it straight back is rejected.
  const w2 = createScriptedWriter((_i, n) => ({ decision: "revise", summary: "", structural_operations_json: [JSON.stringify(n === 1 ? { op: "move_scene", op_id: "a", scene_id: "CH_02", to_index: 1 } : { op: "move_scene", op_id: "b", scene_id: "CH_02", to_index: 2 })], narrator_patches: [], recommendation_responses: [], expected_benefit: "", confidence: 0.5 }));
  const c2 = createScriptedCritic((_i, n) => report(60 + n * 5, 60 + n * 5));
  const r2 = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer: w2, critic: c2, config: { max_iterations: 2, narrative_threshold: 99, craft_threshold: 99, plateau_epsilon: 0 } });
  assert.equal(r2.iterations[1].verdict, "rejected_cycle");

  // Provider failure: critic always throws, baseline is preserved, retries are bounded.
  const c3 = createScriptedCritic(() => { throw new Error("upstream 503"); });
  const r3 = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer: w2, critic: c3 });
  assert.equal(r3.stop_reason, "provider_failure");
  assert.equal(c3.calls.length, 2, "one retry, then stop");
  assert.equal(r3.candidate, null);

  // Budget: 2 calls allowed (baseline + writer) leaves no room for the critic.
  const c4 = createScriptedCritic(() => report(60, 60));
  const w4 = createScriptedWriter(() => ({ decision: "revise", summary: "", structural_operations_json: [JSON.stringify({ op: "move_scene", op_id: "a", scene_id: "CH_02", to_index: 1 })], narrator_patches: [], recommendation_responses: [], expected_benefit: "", confidence: 0.5 }));
  const r4 = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer: w4, critic: c4, config: { max_model_calls: 2 } });
  assert.equal(r4.stop_reason, "budget_exhausted");
  assert.equal(r4.calls_used, 2);

  // Stale base.
  const r5 = await runEditorialOrchestration({ master_markdown: FIXTURE, expected_base_version_id: "mv-old", knowledge: TEST_KB, writer: w4, critic: c4 });
  assert.equal(r5.stop_reason, "stale_base");
});

test("orchestrator: fabricated tape in a writer patch never reaches a candidate; pinned narration is not offered for editing", async () => {
  const blocks = parseManuscript(FIXTURE).sections[1].blocks.filter((b) => b.type === "narrator");
  const writer = createScriptedWriter(() => ({
    decision: "revise", summary: "", structural_operations_json: [],
    narrator_patches: [{ section_id: "CH_01", block_id: blocks[1].id, updated_narrator_markdown: "[LOGAN]\nThat was a turning point.\n\n> I never said that.", rationale: "" }],
    recommendation_responses: [], expected_benefit: "", confidence: 0.5,
  }));
  const critic = createScriptedCritic(() => report(60, 60));
  const r = await runEditorialOrchestration({ master_markdown: FIXTURE, knowledge: TEST_KB, writer, critic, pinned_block_ids: [blocks[0].id], config: { max_iterations: 1 } });
  assert.ok(!writer.calls[0].editable_narrator_blocks.some((b) => b.block_id === blocks[0].id), "pinned block is not editable");
  const cand = r.candidate?.markdown || FIXTURE;
  assert.ok(!cand.includes("> I never said that."));
  assert.ok(verifyProtectedIntegrity(FIXTURE, cand).ok);
});

// ============================================================================
// Prompt contract (forced-edit removal)
// ============================================================================

test("prompts no longer force rewrites and define separate writer and critic roles", () => {
  assert.ok(!/Rewrite EVERY block/i.test(EDITOR_SYSTEM_PROMPT));
  assert.match(EDITOR_SYSTEM_PROMPT, /NO CHANGE REQUIRED/);
  assert.match(AUDITOR_SYSTEM_PROMPT, /empty surgical_directives/i);
  assert.match(AUDITOR_SYSTEM_PROMPT, /EXECUTIVE PRODUCER STORY REVIEW/);
  assert.match(WRITER_ARCHITECT_SYSTEM_PROMPT, /no_change_required/);
  assert.match(CRITIC_STORY_REVIEW_SYSTEM_PROMPT, /independent/i);
  assert.ok(!/writer'?s? (?:rationale|justification) (?:is|follows)/i.test(CRITIC_STORY_REVIEW_SYSTEM_PROMPT));
});
