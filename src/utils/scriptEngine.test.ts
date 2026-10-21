import test from "node:test";
import assert from "node:assert/strict";
import {
  parseManuscript,
  scanPrivacyFence,
  applySurgicalPatches,
  applyNarratorPatches,
  verifyCueIntegrity,
  computeWordDiff,
  computeUpdatedLockedActs,
  scanQuoteEchoes,
  analyzeSectionCliffhangers,
  extractReceiptBoard,
  generateDeterministicShowrunnerVariants,
  rollbackSingleSection,
  assembleManuscript,
  analyzeCrossChapterResonance,
  analyzeHumanComplexity,
  getComplexityForSection,
  analyzeTapeFreshness,
  getTapeFreshnessForSection,
} from "./scriptEngine.ts";
import {
  extractJsonFromText,
  sanitizeApiErrorMessage,
} from "./safeFetch.ts";
import { INITIAL_MANUSCRIPT } from "./sampleManuscript.ts";

const SAMPLE_SCRIPT = `# THE PAPER TRAIL — INVESTIGATIVE DOCUMENTARY MANUSCRIPT

## [PROLOGUE] — THE RECORDING RULE

[Male Narrator] [Conversational, Dry]
Every whisper network leaves a paper trail. Most people never bother to check the timestamps. [Beat]

[ARCHIVAL — CLIP-01: ANGELA MAGGARD LIVESTREAM (TIMESTAMP 00:14:22)]

> "If you come into this space, assume every single word, every DM, and every phone call is being logged for the file."

[Male Narrator] [Matter-of-fact]
That was Angela's rule. Not mine.

# ACT ONE: THE DOSSIER ARCHITECTURE

## [A101] — SEPTEMBER 8 INTERVENTION

[Male Narrator] [Calm]
Let's go back to September 8th. It could be argued that the narrative started when host Oor made a remark on panel.

[LOGAN READING — TRANSCRIPT EXCERPT 09-08-A]

> "LOGAN: Hey, stop right there. That is not cool and completely inappropriate. Shut that topic down right now."

[Male Narrator] [Dry]
Notice how quickly that ten-second clip disappeared when Angela needed a pretext to drop screenshots.

# ACT TWO: THE SELECTIVE LEAK

## [A204] — TIMELINE RECEIPTS

[Male Narrator] [Conversational]
Here is the first message log. And then after that, here is the second log from the archive.

[ARCHIVAL — CLIP-04: SAV TIMELINE LOGS]

> "Timestamp 21:04 UTC — Coordinate the drop before he goes live."

[Male Narrator] [Unbothered]
When Sav broke ranks with the whisper network and handed over the primary logs, the whole coordination architecture was sitting right there in black and white.

## [EPILOGUE] — THE SHAPE-SHIFTERS

[Male Narrator] [Measured, Resonant]
Shape-shifters rely on secret dossiers and hollow litigation threats. The moment verifiable records and timestamps hit the light, the performance collapses. [Beat]

# PRIVATE PRODUCTION REFERENCES

- Exhibit A: Audio Master Reel 09-08-RAW.wav (SHA-256: 8f9d2a1c)
- Exhibit B: Discord Server Export Log #4412
`;

test("parseManuscript splits PROLOGUE, A101, A204, EPILOGUE, and APPENDIX accurately", () => {
  const parsed = parseManuscript(SAMPLE_SCRIPT);
  const ids = parsed.sections.map((s) => s.section_id);
  assert.deepEqual(ids, ["PROLOGUE", "A101", "A204", "EPILOGUE", "APPENDIX"]);

  const a101 = parsed.sections.find((s) => s.section_id === "A101")!;
  assert.equal(a101.act_id, "ACT ONE");

  const blockTypes = a101.blocks.map((b) => b.type);
  assert.deepEqual(blockTypes, [
    "locked_meta",
    "locked_meta",
    "narrator",
    "reading",
    "blockquote",
    "narrator",
  ]);
});

test("scanPrivacyFence passes clean script and catches forbidden phrases & Hera references", () => {
  const cleanResult = scanPrivacyFence(SAMPLE_SCRIPT);
  assert.equal(cleanResult.privacy_gate_passed, true);
  assert.equal(cleanResult.forbidden_domestic_phrases_found.length, 0);
  assert.equal(cleanResult.hera_references_found, false);

  const contaminatedScript =
    SAMPLE_SCRIPT +
    "\n\n[Male Narrator]\nShe said things were about to get very, very, very ugly and mentioned the October Hera call while making excuses on why you can’t answer.";
  const dirtyResult = scanPrivacyFence(contaminatedScript);
  assert.equal(dirtyResult.privacy_gate_passed, false);
  assert.equal(dirtyResult.hera_references_found, true);
  assert.equal(
    dirtyResult.forbidden_domestic_phrases_found.includes("very, very, very ugly"),
    true
  );
  assert.equal(
    dirtyResult.forbidden_domestic_phrases_found.includes("making excuses on why you can't"),
    true
  );
});

test("applySurgicalPatches and applyNarratorPatches splice ONLY [Male Narrator] blocks and respect pinned blocks", () => {
  const maliciousEditorPatch = `## [A101] — SEPTEMBER 8 INTERVENTION

[Male Narrator] [Conversational, Direct]
On September 8th, host Oor crossed a line on the panel regarding Angela's deceased child. I didn't sit back—I keyed the mic immediately and shut it down. [Beat]

[LOGAN READING — TRANSCRIPT EXCERPT 09-08-A]

> "TAMPERED QUOTE: Editor tried to change this primary evidence quote!"

[Male Narrator] [Dry]
Angela erased that intervention completely. She needed a clean pretext to dump leaked screenshots.
`;

  const result = applySurgicalPatches(
    SAMPLE_SCRIPT,
    [{ section_id: "A101", updated_section_markdown: maliciousEditorPatch }],
    ["PROLOGUE"]
  );

  assert.equal(result.anySectionChanged, true);
  assert.equal(result.cueIntegrity.tag_integrity, true);
  assert.equal(result.assembledMarkdown.includes("TAMPERED QUOTE"), false);
  assert.equal(
    result.assembledMarkdown.includes("I keyed the mic immediately and shut it down."),
    true
  );

  // Verify pinned block ID protection in applyNarratorPatches
  const parsed = parseManuscript(SAMPLE_SCRIPT);
  const a101Narrator = parsed.sections
    .find((s) => s.section_id === "A101")!
    .blocks.find((b) => b.type === "narrator")!;

  const pinnedRes = applyNarratorPatches(
    SAMPLE_SCRIPT,
    [
      {
        section_id: "A101",
        block_id: a101Narrator.id,
        updated_narrator_markdown: "[Male Narrator]\nAttempted override of pinned block.",
      },
    ],
    [],
    new Set([a101Narrator.id])
  );
  assert.equal(pinnedRes.anySectionChanged, false);
});

test("verifyCueIntegrity, computeWordDiff, and computeUpdatedLockedActs work deterministically", () => {
  const integrity = verifyCueIntegrity(SAMPLE_SCRIPT, SAMPLE_SCRIPT);
  assert.equal(integrity.tag_integrity, true);
  assert.equal(integrity.blockquotes_before, 3);
  assert.equal(integrity.archival_cues_before, 2);
  assert.equal(integrity.reading_blocks_before, 1);

  const diff = computeWordDiff(
    "[Male Narrator] It could be argued that the file was lost.",
    "[Male Narrator] The file was deliberately buried."
  );
  assert.equal(diff.some((d) => d.type === "removed"), true);
  assert.equal(diff.some((d) => d.type === "added"), true);

  const parsed = parseManuscript(SAMPLE_SCRIPT);
  const scan = scanPrivacyFence(SAMPLE_SCRIPT);
  const locked = computeUpdatedLockedActs(
    ["PROLOGUE"],
    parsed,
    {
      pass_number: 1,
      privacy_and_tag_audit: {
        forbidden_domestic_phrases_found: [],
        hera_references_found: false,
        privacy_gate_passed: true,
      },
      metrics: {
        narrative_drive: { brutal_critique: "A204 drags.", score: 17.5 },
        spoken_cadence: { brutal_critique: "A101 has hedging.", score: 17.0 },
        tape_integration: { brutal_critique: "A204 repeats clip.", score: 17.0 },
        investigative_authority: { brutal_critique: "A101 softens premise.", score: 16.5 },
        narrator_composure: { brutal_critique: "Solid composure.", score: 18.5 },
      },
      composite_score: 86.5,
      min_category_score: 16.5,
      passed_threshold: false,
      locked_acts: ["PROLOGUE"],
      surgical_directives: [
        { section_id: "A101", flaw: "Hedging.", editorial_order: "Remove hedging." },
        { section_id: "A204", flaw: "Lead-in.", editorial_order: "Tighten." },
      ],
    },
    scan
  );
  assert.equal(locked.includes("PROLOGUE"), true);
  assert.equal(locked.includes("EPILOGUE"), true);
});

test("parseManuscript and applyNarratorPatches handle blank lines after [Male Narrator] and multi-paragraph narrator blocks", () => {
  const spacedScript = `# ACT ONE

[Male Narrator — Calm]

First paragraph separated by a blank line after the narrator tag.

Second continuation paragraph in the same narrator turn.

[ARCHIVAL — CLIP-01]

> "A locked quote that cannot change."

[Male Narrator]

Closing narrator paragraph after the quote.
`;

  const parsed = parseManuscript(spacedScript);
  assert.equal(parsed.sections.length, 1);
  const narrators = parsed.sections[0].blocks.filter((b) => b.type === "narrator");
  assert.equal(narrators.length, 2);

  const patched = applyNarratorPatches(
    spacedScript,
    [
      {
        section_id: parsed.sections[0].section_id,
        block_id: narrators[0].id,
        updated_narrator_markdown:
          "[Male Narrator — Calm]\n\nSharpened opening paragraph.\n\nSharpened second paragraph.",
      },
    ],
    []
  );

  assert.equal(patched.anySectionChanged, true);
  assert.equal(patched.sectionDiffs.length, 1);
  assert.equal(patched.assembledMarkdown.includes("Sharpened second paragraph."), true);
  assert.equal(patched.cueIntegrity.tag_integrity, true);
});

test("scanQuoteEchoes, analyzeSectionCliffhangers, extractReceiptBoard, generateDeterministicShowrunnerVariants, and rollbackSingleSection work deterministically", () => {
  // 1. Quote-Echo detection on SAMPLE_SCRIPT (A204 has a pre-quote echo)
  const echoReport = scanQuoteEchoes(SAMPLE_SCRIPT);
  assert.equal(echoReport.totalEchoes >= 1, true);
  assert.equal(
    echoReport.echoes.some((e) => e.section_id === "A204"),
    true
  );

  // 2. Section Cliffhanger Check
  const cliffReport = analyzeSectionCliffhangers(SAMPLE_SCRIPT);
  assert.equal(cliffReport.items.length >= 3, true);

  // 3. Receipt Board & Contradiction Pairs
  const receiptBoard = extractReceiptBoard(SAMPLE_SCRIPT);
  assert.equal(receiptBoard.receipts.length, 3);
  assert.equal(receiptBoard.contradictionPairs.length >= 1, true);

  // 4. Showrunner Variants (Option D Signature Default + Creative Alternatives)
  const variants = generateDeterministicShowrunnerVariants(
    "[Male Narrator] [Calm]\nLet's go back to September 8th. It could be argued that the narrative started when host Oor made a remark on panel."
  );
  assert.equal(variants.length, 4);
  assert.equal(variants[0].style_id, "paper_trail_signature");
  assert.equal(variants[0].is_default, true);
  assert.equal(variants[1].style_id, "dry_minimalist");
  assert.equal(variants[2].style_id, "investigative_forensic");
  assert.equal(variants[3].style_id, "serial_cadence");

  // 5. Single-section rollback preserves edits in other sections
  const parsed = parseManuscript(SAMPLE_SCRIPT);
  const a101Block = parsed.sections
    .find((s) => s.section_id === "A101")!
    .blocks.find((b) => b.type === "narrator")!;
  const a204Block = parsed.sections
    .find((s) => s.section_id === "A204")!
    .blocks.find((b) => b.type === "narrator")!;

  const editedBoth = applyNarratorPatches(
    SAMPLE_SCRIPT,
    [
      {
        section_id: "A101",
        block_id: a101Block.id,
        updated_narrator_markdown: "[Male Narrator]\nEdited A101 line.",
      },
      {
        section_id: "A204",
        block_id: a204Block.id,
        updated_narrator_markdown: "[Male Narrator]\nEdited A204 line.",
      },
    ],
    []
  ).assembledMarkdown;

  const rolledBack = rollbackSingleSection(editedBoth, SAMPLE_SCRIPT, "A101");
  assert.equal(rolledBack.restored, true);
  assert.equal(rolledBack.updatedMarkdown.includes("Edited A101 line."), false);
  assert.equal(rolledBack.updatedMarkdown.includes("Edited A204 line."), true);
});

test("extractJsonFromText and sanitizeApiErrorMessage safely intercept <!doctype html> responses and JSON SyntaxErrors", () => {
  assert.throws(
    () => extractJsonFromText('<!doctype html><html><body>Gateway Timeout</body></html>'),
    /HTML_RESPONSE_RECEIVED/
  );

  const extracted = extractJsonFromText<{ ok: boolean }>(
    '```json\n{"ok": true}\n```'
  );
  assert.equal(extracted.ok, true);

  const sanitized = sanitizeApiErrorMessage(
    new SyntaxError('Unexpected token \'<\', "<!doctype "... is not valid JSON'),
    "Friendly fallback message"
  );
  assert.equal(sanitized, "Friendly fallback message");
});

test("default INITIAL_MANUSCRIPT parses cleanly with 13 sections, 57 quotes, 39 archival cues, and tag integrity", () => {
  const parsed = parseManuscript(INITIAL_MANUSCRIPT);
  assert.equal(parsed.sections.length, 13);
  assert.equal(parsed.sections[0].section_id, "PROLOGUE");
  assert.equal(parsed.sections[1].section_id, "CH_01");
  assert.equal(parsed.sections[10].section_id, "CH_10");
  assert.equal(parsed.sections[11].section_id, "EPILOGUE");
  assert.equal(parsed.sections[12].section_id, "APPENDIX");

  const privacy = scanPrivacyFence(INITIAL_MANUSCRIPT);
  assert.equal(privacy.privacy_gate_passed, true);
  assert.equal(privacy.forbidden_domestic_phrases_found.length, 0);

  const assembled = assembleManuscript(parsed);
  const cueCheck = verifyCueIntegrity(INITIAL_MANUSCRIPT, assembled);
  assert.equal(cueCheck.tag_integrity, true);
  assert.equal(cueCheck.blockquotes_before, 57);
  assert.equal(cueCheck.archival_cues_before, 39);
  assert.equal(cueCheck.reading_blocks_before, 10);
});

test("analyzeCrossChapterResonance detects echo & foreshadowing motifs, contradiction evolutions, and splices Option D", () => {
  const report = analyzeCrossChapterResonance(INITIAL_MANUSCRIPT);
  assert.equal(report.totalLinks, 9);
  assert.equal(report.resonatedCount, 8);
  assert.equal(report.missingLinkCount, 1);
  assert.equal(report.overProsecutorialCount, 0);
  assert.ok(report.resonanceHealthScore >= 90);

  // Check specific required case: Angela February 18 remark in Chapter 2 vs Chapter 5 Petty Space
  const rainyDay = report.items.find((i) => i.id === "RESONANCE-RAINY-DAY");
  assert.ok(rainyDay);
  assert.equal(rainyDay?.type, "echo_foreshadowing");
  assert.equal(rainyDay?.early_moment.section_id, "CH_02");
  assert.equal(rainyDay?.later_moment.section_id, "CH_05");
  assert.equal(rainyDay?.status, "resonated");

  // Check specific required case: Discord locked principle vs CPS / batches contradiction
  const discordWeaponize = report.items.find((i) => i.id === "RESONANCE-DISCORD-WEAPONIZE");
  assert.ok(discordWeaponize);
  assert.equal(discordWeaponize?.type, "contradiction_evolution");
  assert.equal(discordWeaponize?.early_moment.section_id, "CH_07");
  assert.equal(discordWeaponize?.later_moment.section_id, "CH_07");
  assert.equal(discordWeaponize?.status, "resonated");

  // Check the latent opportunity in EPILOGUE and test surgical splicing
  const epilogueItem = report.items.find((i) => i.id === "RESONANCE-EPILOGUE-MISTAKES");
  assert.ok(epilogueItem);
  assert.equal(epilogueItem?.status, "missing_link");
  assert.ok(epilogueItem?.target_narrator_block_id);

  // Splice Option D signature narration into EPILOGUE
  const patched = applyNarratorPatches(INITIAL_MANUSCRIPT, [
    {
      section_id: epilogueItem!.target_section_id,
      block_id: epilogueItem!.target_narrator_block_id!,
      updated_narrator_markdown: epilogueItem!.suggested_option_d_narration,
    },
  ]);

  const reportAfter = analyzeCrossChapterResonance(patched.assembledMarkdown);
  assert.equal(reportAfter.resonatedCount, 9);
  assert.equal(reportAfter.missingLinkCount, 0);
  assert.equal(reportAfter.resonanceHealthScore, 100);

  const epilogueItemAfter = reportAfter.items.find((i) => i.id === "RESONANCE-EPILOGUE-MISTAKES");
  assert.equal(epilogueItemAfter?.status, "resonated");
});

test("analyzeHumanComplexity maps 6 participants, audits Sav in the middle agency, and enforces Angela archetype safeguards", () => {
  const report = analyzeHumanComplexity(INITIAL_MANUSCRIPT);

  assert.equal(report.characters.length, 6);
  const names = report.characters.map((c) => c.name);
  assert.deepEqual(names, ["Angela Maggard", "Savannah ('Sav')", "Logan Black", "Lynn", "Urs", "Skittles"]);

  // Sav in the middle audit on default manuscript
  assert.equal(report.savNuanceAudit.sav_in_middle_score, 100);
  assert.equal(report.savNuanceAudit.bystander_trap_detected, false);
  assert.equal(report.savNuanceAudit.agency_moments_acknowledged.gassed_angela_up, true);
  assert.equal(report.savNuanceAudit.agency_moments_acknowledged.not_a_honeypot, true);
  assert.equal(report.savNuanceAudit.agency_moments_acknowledged.demanded_receipt_deletion, true);
  assert.equal(report.savNuanceAudit.agency_moments_acknowledged.corrected_photo_allegation, true);
  assert.equal(report.savNuanceAudit.agency_moments_acknowledged.drew_line_on_children, true);

  // Angela profile
  const angela = report.characters.find((c) => c.character_id === "angela");
  assert.ok(angela);
  assert.equal(angela?.archetype_risk_flag, false);
  assert.ok((angela?.humanizing_anchors.length ?? 0) >= 3);
  assert.ok((angela?.arc_moments.length ?? 0) >= 4);

  // Test getComplexityForSection
  const ch01Moments = getComplexityForSection(report, "CH_01");
  assert.ok(ch01Moments.length >= 2);
  const ch01Angela = ch01Moments.find((m) => m.complexity_verdict === "humanizing_anchor");
  assert.ok(ch01Angela);

  // Test archetype risk flag detection when cartoon villain terms are present
  const badScript = INITIAL_MANUSCRIPT.replace(
    "That was Angela Maggard. And the Logan she's talking about is me.",
    "Angela was purely evil and a manipulative demon."
  );
  const badReport = analyzeHumanComplexity(badScript);
  const badAngela = badReport.characters.find((c) => c.character_id === "angela");
  assert.equal(badAngela?.archetype_risk_flag, true);
  assert.ok(badReport.archetypeWarningsCount > 0);
});

test("analyzeTapeFreshness audits lead-in spoilers and post-tape over-explanation, calculating freshness score and splicing Option D hand-offs", () => {
  const defaultReport = analyzeTapeFreshness(INITIAL_MANUSCRIPT);
  assert.ok(defaultReport.totalTapeHandoffs > 0);
  assert.ok(defaultReport.freshnessScore >= 90);

  // Test Preemptive Spoiler detection
  const spoiledScript = SAMPLE_SCRIPT.replace(
    "Let's go back to September 8th. It could be argued that the narrative started when host Oor made a remark on panel.",
    "In the clip you are about to hear, watch how Logan was about to threaten to ruin my friends."
  );
  const spoilerReport = analyzeTapeFreshness(spoiledScript);
  assert.ok(spoilerReport.preemptiveSpoilersCount >= 1);
  const leadInIssue = spoilerReport.issues.find(
    (i) => i.issue_type === "preemptive_lead_in_spoiler"
  );
  assert.ok(leadInIssue);
  assert.equal(leadInIssue?.section_id, "A101");
  assert.ok(leadInIssue?.option_d_fresh_alternative.includes("[Male Narrator]"));

  // Test Post-Tape Recap detection
  const recapScript = SAMPLE_SCRIPT.replace(
    "That was Angela's rule. Not mine.",
    "In other words, what she really meant was that everything was being recorded."
  );
  const recapReport = analyzeTapeFreshness(recapScript);
  assert.ok(recapReport.postTapeRecapsCount >= 1);
  const recapIssue = recapReport.issues.find(
    (i) => i.issue_type === "post_tape_over_explanation"
  );
  assert.ok(recapIssue);
  assert.equal(recapIssue?.section_id, "PROLOGUE");
  assert.ok(recapIssue?.option_d_fresh_alternative.includes("[Beat]"));

  // Test getTapeFreshnessForSection
  const prologueIssues = getTapeFreshnessForSection(recapReport, "PROLOGUE");
  assert.equal(prologueIssues.length, 1);
  assert.equal(prologueIssues[0].id, recapIssue?.id);

  // Test Surgical Splicing to restore tape freshness
  const patched = applyNarratorPatches(spoiledScript, [
    {
      section_id: leadInIssue!.section_id,
      block_id: leadInIssue!.narrator_block_id,
      updated_narrator_markdown: leadInIssue!.option_d_fresh_alternative,
    },
  ]);
  const cleanReport = analyzeTapeFreshness(patched.assembledMarkdown);
  assert.equal(cleanReport.preemptiveSpoilersCount, 0);

  // Verify quote and cue integrity is completely intact
  const cueCheck = verifyCueIntegrity(SAMPLE_SCRIPT, patched.assembledMarkdown);
  assert.equal(cueCheck.tag_integrity, true);
  assert.equal(cueCheck.blockquotes_before, cueCheck.blockquotes_after);
  assert.equal(cueCheck.archival_cues_before, cueCheck.archival_cues_after);
});


