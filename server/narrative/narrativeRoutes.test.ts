import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";

process.env.RSRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rsre-narrative-test-"));

const { createApp } = await import("../../server.ts");
const { INITIAL_MANUSCRIPT } = await import("../../src/utils/sampleManuscript.ts");
const { manuscriptVersionId } = await import("../../src/utils/narrative/hash.ts");
const { createScriptedCritic, createScriptedWriter } = await import("../../src/utils/narrative/providers.ts");
const { verifyProtectedIntegrity } = await import("../../src/utils/narrative/structuralOps.ts");

function report(n: number, c: number) {
  return {
    global_assessment: { summary: "s", central_question: "q", narrative_effectiveness: { score: n, rationale: "" }, craftsmanship: { score: c, rationale: "" } },
    scene_findings: [{ scene_id: "CH_01", role: "human_texture", finding: "Urs is never named here.", basis: "established_in_manuscript", priority: "high" }],
    listener_findings: [], character_observations: [], opportunities: [], proposed_operations: [], critical_failures: [],
    confidence: { overall: 0.6, uncertainties: [] }, recommended_priority: [],
  };
}

async function withServer(opts: Parameters<typeof createApp>[0], fn: (base: string) => Promise<void>) {
  const server = createApp(opts).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base: string, p: string, body: unknown) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("narrative routes: providers, persisted analysis, staged editorial run, and version-checked acceptance", async () => {
  const urs = /(\[LOGAN\]\n\nI want you to hear that appreciation)/;
  assert.ok(urs.test(INITIAL_MANUSCRIPT));
  const writer = createScriptedWriter((input) => {
    const blk = input.editable_narrator_blocks.find((b) => b.current_narrator_markdown.includes("I want you to hear that appreciation"));
    return {
      decision: "revise",
      summary: "Name Urs where the listener first hears him.",
      structural_operations_json: [],
      narrator_patches: blk ? [{ section_id: blk.section_id, block_id: blk.block_id, updated_narrator_markdown: blk.current_narrator_markdown.replace("I want you to hear that appreciation", "That was Urs. I want you to hear that appreciation"), rationale: "Listener cannot place Urs in CH_07 otherwise." }] : [],
      recommendation_responses: [],
      expected_benefit: "CH_07's 'Remember Urs' lands.",
      confidence: 0.7,
    };
  });
  let n = 0;
  const critic = createScriptedCritic(() => (++n === 1 ? report(78, 80) : report(82, 81)));

  await withServer({ narrativeProviders: { writer: () => writer, critic: () => critic } }, async (base) => {
    const prov = await (await fetch(base + "/api/narrative/providers")).json();
    assert.equal(prov.writer.available, true);
    assert.equal(prov.writer.kind, "simulated", "injected mocks are reported as simulated");

    const analyze = await (await post(base, "/api/narrative/analyze", { manuscript: INITIAL_MANUSCRIPT })).json();
    assert.equal(analyze.model.manuscript_version_id, manuscriptVersionId(INITIAL_MANUSCRIPT));
    assert.equal(analyze.timeline.states.length, 12);
    assert.ok(fs.existsSync(path.join(process.env.RSRE_DATA_DIR as string, "models", `${analyze.model.manuscript_version_id}.json`)));

    const run = await (await post(base, "/api/narrative/run", { manuscript: INITIAL_MANUSCRIPT, expected_base_version_id: manuscriptVersionId(INITIAL_MANUSCRIPT), config: { max_iterations: 1, narrative_threshold: 95, craft_threshold: 95 } })).json();
    assert.equal(run.iterations[0].verdict, "accepted_best");
    assert.equal(run.iterations[0].critic_scope, "delta", "a one-scene narration fix is re-reviewed incrementally");
    assert.ok(critic.calls[1].scenes.length < 12 && critic.calls[1].scenes.some((s: { scene_id: string }) => s.scene_id === "CH_01"));
    assert.ok(run.candidate);
    assert.ok(run.candidate.markdown.includes("That was Urs."));
    assert.ok(verifyProtectedIntegrity(INITIAL_MANUSCRIPT, run.candidate.markdown).ok);

    // Listener effect of the narration fix: Urs is now identified in CH_01.
    const after = await (await post(base, "/api/narrative/analyze", { manuscript: run.candidate.markdown })).json();
    const ch1 = after.timeline.states[1];
    assert.ok(!ch1.confusion.some((c: { kind: string; term: string; resolved_within_scene: boolean }) => c.kind === "unidentified_voice" && c.term === "Urs" && !c.resolved_within_scene));
    assert.ok(after.model.changed_scene_ids.includes("CH_01"));

    const list = await (await fetch(base + "/api/narrative/candidates")).json();
    assert.ok(list.candidates.some((c: { candidate_id: string }) => c.candidate_id === run.candidate.candidate_id));
    assert.ok(!("markdown" in list.candidates[0]), "listing omits manuscript bodies");

    const stale = await post(base, `/api/narrative/candidates/${run.candidate.candidate_id}/decision`, { decision: "accept", current_manuscript: INITIAL_MANUSCRIPT + "\nnewer edit" });
    assert.equal(stale.status, 409, "a candidate cannot overwrite a newer master");
    const ok = await (await post(base, `/api/narrative/candidates/${run.candidate.candidate_id}/decision`, { decision: "accept", current_manuscript: INITIAL_MANUSCRIPT })).json();
    assert.equal(ok.ok, true);
    assert.equal(ok.base_markdown, INITIAL_MANUSCRIPT, "rollback text is returned with the accepted candidate");

    const history = await (await fetch(base + "/api/narrative/history")).json();
    assert.ok(history.history.some((h: { event: string }) => h.event === "candidate_accepted"));
  });
});

test("narrative run refuses to substitute providers; /api/edit with no flagged sections is NO CHANGE REQUIRED", async () => {
  await withServer({ narrativeProviders: { writer: () => null, critic: () => createScriptedCritic(() => report(80, 80)) } }, async (base) => {
    const r = await post(base, "/api/narrative/run", { manuscript: INITIAL_MANUSCRIPT });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.writer_available, false);
    assert.match(body.error, /will not substitute/);

    const edit = await (await post(base, "/api/edit", { manuscript: INITIAL_MANUSCRIPT, targetedSections: [], surgicalDirectives: [] })).json();
    if (edit.mode !== "fallback_simulated") {
      assert.equal(edit.mode, "no_change_required");
      assert.equal(edit.patchResponse.narrator_patches.length, 0);
    }
  });
});
