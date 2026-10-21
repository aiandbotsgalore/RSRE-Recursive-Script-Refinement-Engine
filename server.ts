import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import {
  AUDITOR_SYSTEM_PROMPT,
  EDITOR_SYSTEM_PROMPT,
  COPILOT_SYSTEM_PROMPT,
} from "./src/utils/prompts.ts";
import {
  parseManuscript,
  resolveSectionById,
  scanPrivacyFence,
  scanQuoteEchoes,
  analyzeSectionCliffhangers,
  analyzeCrossChapterResonance,
  generateDeterministicShowrunnerVariants,
  extractReceiptBoard,
  applyNarratorPatches,
  applySurgicalPatches,
  convertSectionPatchesToNarratorPatches,
  buildDeterministicNarratorPatches,
  verifyCueIntegrity,
  type AuditorReport,
  type NarratorBlockPatch,
  type ShowrunnerVariantItem,
  type CrossChapterResonanceReport,
} from "./src/utils/scriptEngine.ts";
import {
  getSimulatedAuditReport,
  getSimulatedEditorPatches,
} from "./src/utils/sampleManuscript.ts";
import { PAPER_TRAIL_KNOWLEDGE } from "./src/utils/narrative/knowledgeBase.ts";
import { buildStoryModel, buildStoryDigest, attachSemantic, type StoryModel, type SceneSemantic } from "./src/utils/narrative/storyModel.ts";
import {
  simulateListenerTimeline,
  buildListenerContext,
  verifyListenerIsolation,
  attachPrediction,
  scenesNeedingPrediction,
  type ListenerTimeline,
  type ListenerPrediction,
} from "./src/utils/narrative/listenerModel.ts";
import { buildDeterministicNarrativeReport, normalizeNarrativeReport } from "./src/utils/narrative/narrativeReport.ts";
import { checkCandidateAcceptable, type ManuscriptCandidate } from "./src/utils/narrative/structuralOps.ts";
import { runEditorialOrchestration, buildListenerDigest, type OrchestratorConfig } from "./src/utils/narrative/orchestrator.ts";
import type { CriticProvider, WriterProvider } from "./src/utils/narrative/providers.ts";
import { manuscriptVersionId } from "./src/utils/narrative/hash.ts";
import { checkCodexStatus, createCodexWriter, runCodexJson, editorPatchJsonSchema } from "./server/narrative/codexWriter.ts";
import { createGeminiCritic, CRITIC_MODEL_CANDIDATES } from "./server/narrative/geminiCritic.ts";
import { checkAgyStatus, createAntigravityCritic } from "./server/narrative/antigravityCritic.ts";
import * as narrativeStore from "./server/narrative/store.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_CANDIDATES = [
  "gemini-2.5-pro",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-flash-latest",
] as const;

// Cache models that report a 0 free-tier limit or 429 quota exhaustion so runs don't waste time re-querying them
const zeroQuotaModels = new Set<string>();

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function hasValidApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim() !== "" && key !== "MY_GEMINI_API_KEY");
}

function cleanJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("<")) {
    throw new Error("Received non-JSON HTML response from upstream model.");
  }
  const unfenced = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim()
    : trimmed;

  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1);
  }
  return unfenced;
}

async function generateWithModelFallback<T>(
  ai: GoogleGenAI,
  options: {
    contents: string;
    systemInstruction: string;
    temperature: number;
    responseSchema: Record<string, unknown>;
    timeoutMs?: number;
    /** Restrict the fallback chain (the narrative critic uses Pro models only, never Flash). */
    candidates?: readonly string[];
    thinkingLevel?: ThinkingLevel;
  }
): Promise<{ data: T; modelUsed: string }> {
  let lastError: unknown = null;
  const timeoutMs = options.timeoutMs ?? 60000;
  const pool = options.candidates && options.candidates.length > 0 ? options.candidates : MODEL_CANDIDATES;

  const activeCandidates = pool.filter((m) => !zeroQuotaModels.has(m));
  const candidatesToTry = activeCandidates.length > 0 ? activeCandidates : pool;

  for (const modelName of candidatesToTry) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Model ${modelName} timed out after ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs
        );
      });

      const response = await Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: options.contents,
          config: {
            systemInstruction: options.systemInstruction,
            temperature: options.temperature,
            responseMimeType: "application/json",
            responseSchema: options.responseSchema,
            thinkingConfig: {
              thinkingLevel: options.thinkingLevel ?? ThinkingLevel.LOW,
            },
          },
        }),
        timeoutPromise,
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const cleaned = cleanJsonText(response.text || "{}");
      const parsed = JSON.parse(cleaned) as T;
      return {
        data: parsed,
        modelUsed: modelName,
      };
    } catch (err: unknown) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("limit: 0") ||
        msg.includes("NOT_FOUND") ||
        msg.includes("404") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("quota") ||
        msg.includes("Quota exceeded")
      ) {
        zeroQuotaModels.add(modelName);
      }
      // Always continue to the next candidate on rate-limit, HTML proxy error, timeout, or JSON truncation
      continue;
    }
  }

  throw lastError || new Error("All Gemini models failed to respond.");
}

function toFriendlyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const raw = error.message || "";
    const lower = raw.toLowerCase();
    if (
      raw.includes("429") ||
      raw.includes("RESOURCE_EXHAUSTED") ||
      lower.includes("quota")
    ) {
      return "API rate limit or free-tier quota reached across available Gemini models. Please wait a moment and click Retry.";
    }
    if (
      lower.includes("<!doctype") ||
      lower.includes("<html") ||
      lower.includes("unexpected token") ||
      lower.includes("not valid json") ||
      lower.includes("json.parse") ||
      raw.includes("{") ||
      lower.includes("status") ||
      lower.includes("500") ||
      lower.includes("502") ||
      lower.includes("503") ||
      lower.includes("504") ||
      lower.includes("404") ||
      lower.includes("fetch") ||
      lower.includes("timed out")
    ) {
      return "Our AI writing assistant is momentarily busy or unreachable. Your script is safe—please try again.";
    }
    return raw;
  }
  return fallback;
}

const METRIC_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    brutal_critique: {
      type: Type.STRING,
      description:
        "Mandatory 2-sentence editorial critique citing specific section IDs BEFORE the numerical score.",
    },
    score: {
      type: Type.NUMBER,
      description: "Score from 0.0 to 20.0 conditioned on brutal_critique.",
    },
  },
  required: ["brutal_critique", "score"],
  propertyOrdering: ["brutal_critique", "score"],
};

export const AUDITOR_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pass_number: { type: Type.INTEGER },
    privacy_and_tag_audit: {
      type: Type.OBJECT,
      properties: {
        forbidden_domestic_phrases_found: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        hera_references_found: { type: Type.BOOLEAN },
        privacy_gate_passed: { type: Type.BOOLEAN },
      },
      required: [
        "forbidden_domestic_phrases_found",
        "hera_references_found",
        "privacy_gate_passed",
      ],
      propertyOrdering: [
        "forbidden_domestic_phrases_found",
        "hera_references_found",
        "privacy_gate_passed",
      ],
    },
    metrics: {
      type: Type.OBJECT,
      properties: {
        narrative_drive: METRIC_ITEM_SCHEMA,
        spoken_cadence: METRIC_ITEM_SCHEMA,
        tape_integration: METRIC_ITEM_SCHEMA,
        investigative_authority: METRIC_ITEM_SCHEMA,
        narrator_composure: METRIC_ITEM_SCHEMA,
      },
      required: [
        "narrative_drive",
        "spoken_cadence",
        "tape_integration",
        "investigative_authority",
        "narrator_composure",
      ],
      propertyOrdering: [
        "narrative_drive",
        "spoken_cadence",
        "tape_integration",
        "investigative_authority",
        "narrator_composure",
      ],
    },
    composite_score: { type: Type.NUMBER },
    min_category_score: { type: Type.NUMBER },
    passed_threshold: { type: Type.BOOLEAN },
    locked_acts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    surgical_directives: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          section_id: { type: Type.STRING },
          flaw: { type: Type.STRING },
          editorial_order: { type: Type.STRING },
        },
        required: ["section_id", "flaw", "editorial_order"],
        propertyOrdering: ["section_id", "flaw", "editorial_order"],
      },
    },
  },
  required: [
    "pass_number",
    "privacy_and_tag_audit",
    "metrics",
    "composite_score",
    "min_category_score",
    "passed_threshold",
    "locked_acts",
    "surgical_directives",
  ],
  propertyOrdering: [
    "pass_number",
    "privacy_and_tag_audit",
    "metrics",
    "composite_score",
    "min_category_score",
    "passed_threshold",
    "locked_acts",
    "surgical_directives",
  ],
};

export const EDITOR_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrator_patches: {
      type: Type.ARRAY,
      description:
        "Rewritten [Male Narrator] paragraphs matched to the exact section_id and block_id provided in EDITABLE NARRATOR BLOCKS.",
      items: {
        type: Type.OBJECT,
        properties: {
          section_id: {
            type: Type.STRING,
            description: "Exact section_id (e.g., PROLOGUE, A101, A204).",
          },
          block_id: {
            type: Type.STRING,
            description:
              "Exact block_id from EDITABLE NARRATOR BLOCKS (e.g., PROLOGUE-B2, A101-B3, A101-B6).",
          },
          updated_narrator_markdown: {
            type: Type.STRING,
            description:
              "Rewritten [Male Narrator] paragraph(s) only. Must start with [Male Narrator] and must NOT contain > blockquotes, [ARCHIVAL] cues, or # headings.",
          },
        },
        required: ["section_id", "block_id", "updated_narrator_markdown"],
        propertyOrdering: [
          "section_id",
          "block_id",
          "updated_narrator_markdown",
        ],
      },
    },
    editor_changelog: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["narrator_patches", "editor_changelog"],
  propertyOrdering: ["narrator_patches", "editor_changelog"],
};

export interface CreateAppOptions {
  /** Test seam: inject writer/critic providers (e.g. labeled mocks) instead of the live ones. */
  narrativeProviders?: {
    writer?: () => WriterProvider | null;
    critic?: () => CriticProvider | null;
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Call 1 — Showrunner Script Quality Audit
  app.post("/api/audit", async (req, res) => {
    try {
      const {
        manuscript,
        passNumber = 1,
        targetScore = 90,
        lockedActs = [],
        previouslyPolishedSectionIds = [],
        simulate = false,
      } = req.body || {};

      if (!manuscript || typeof manuscript !== "string") {
        res.status(400).json({ error: "Please provide a script to evaluate." });
        return;
      }

      const parsed = parseManuscript(manuscript);
      const privacyScan = scanPrivacyFence(manuscript);
      const quoteEchoReport = scanQuoteEchoes(manuscript);
      const cliffhangerReport = analyzeSectionCliffhangers(manuscript);
      const editableSections = parsed.sections.filter(
        (s) =>
          s.section_id !== "APPENDIX" &&
          s.blocks.some((b) => b.type === "narrator")
      );
      const availableSectionList = editableSections.map(
        (s) => `${s.section_id} ("${s.title}")`
      );
      const polishedSet = new Set<string>(
        (Array.isArray(previouslyPolishedSectionIds)
          ? previouslyPolishedSectionIds
          : []
        ).map((id: string) => String(id).toUpperCase().trim())
      );

      if (simulate || !hasValidApiKey()) {
        const simulated = getSimulatedAuditReport(
          passNumber,
          privacyScan.privacy_gate_passed,
          privacyScan.forbidden_domestic_phrases_found,
          privacyScan.hera_references_found
        );
        res.json({
          report: simulated,
          privacyScan,
          quoteEchoReport,
          cliffhangerReport,
          mode: simulate ? "simulated" : "fallback_simulated",
        });
        return;
      }

      const unpolishedList = editableSections
        .filter((s) => !polishedSet.has(s.section_id.toUpperCase()))
        .map((s) => s.section_id);

      const echoSummaryLines = quoteEchoReport.echoes
        .slice(0, 5)
        .map(
          (e) =>
            `- Section ${e.section_id} (${e.narrator_block_id}, ${e.position}): repeats ${e.repeated_phrases.join(", ")} -> ${e.editorial_fix_directive}`
        )
        .join("\n");

      const weakCliffhangerLines = cliffhangerReport.items
        .filter((c) => c.status === "needs_cliffhanger")
        .slice(0, 4)
        .map((c) => `- Section ${c.section_id}: ${c.editorial_directive}`)
        .join("\n");

      const ai = getGenAIClient();
      // Narrative Intelligence context: whole-story structure and first-time listener state.
      const narrativeModel = buildStoryModel(manuscript, PAPER_TRAIL_KNOWLEDGE);
      const narrativeTimeline = simulateListenerTimeline(manuscript, PAPER_TRAIL_KNOWLEDGE, narrativeModel);
      const narrativeReport = buildDeterministicNarrativeReport(narrativeModel, narrativeTimeline);
      const userPrompt = `PASS NUMBER: ${passNumber}
TARGET COMPOSITE SCORE: ${targetScore} (Minimum Category Score: 18.0/20.0)
AVAILABLE SECTIONS (USE THESE EXACT section_id VALUES IN surgical_directives):
${availableSectionList.join("\n")}
${
  unpolishedList.length > 0
    ? `SECTIONS NOT YET REVIEWED IN EARLIER PASSES: ${unpolishedList.join(", ")}. Issue directives only where a justified improvement exists. An empty list is a valid result.`
    : `Issue directives only where a justified improvement remains. An empty list is a valid result (NO CHANGE REQUIRED).`
}

NARRATIVE INTELLIGENCE (whole-story structure; deterministic signals, judge them editorially):
${buildStoryDigest(narrativeModel)}

FIRST-TIME LISTENER STATE (presented information only):
${buildListenerDigest(narrativeTimeline)}

DETERMINISTIC PRIVACY BLACKLIST SCANNER RESULT:
- privacy_gate_passed: ${privacyScan.privacy_gate_passed}
- forbidden_domestic_phrases_found: ${JSON.stringify(
        privacyScan.forbidden_domestic_phrases_found
      )}
- hera_references_found: ${privacyScan.hera_references_found}
${
  !privacyScan.privacy_gate_passed
    ? `MANDATORY DIRECTIVE REQUIRED: Violations detected in sections ${privacyScan.violations
        .map((v) => `${v.section_id} ("${v.phrase}")`)
        .join(", ")}. Issue a surgical_directive for those section_ids to excise the forbidden phrase and reframe strictly at the forensic chain-of-custody level.`
    : ""
}

DETERMINISTIC QUOTE-ECHO SCANNER RESULT (${quoteEchoReport.totalEchoes} Echoes Detected):
${echoSummaryLines || "Zero quote-echoes detected."}

ACT-BY-ACT CLIFFHANGER & TENSION CHECK (${cliffhangerReport.needsWorkCount} Sections Need Stronger Exit Turn):
${weakCliffhangerLines || "All section exits land on strong turns."}

MANUSCRIPT TO AUDIT:
${manuscript}`;

      let parsedReport: AuditorReport;
      let modelUsed = "";
      try {
        const liveRes = await generateWithModelFallback<AuditorReport>(ai, {
          contents: userPrompt,
          systemInstruction: AUDITOR_SYSTEM_PROMPT,
          temperature: 0.2,
          responseSchema: AUDITOR_RESPONSE_SCHEMA,
        });
        parsedReport = liveRes.data;
        modelUsed = liveRes.modelUsed;
      } catch (auditModelErr) {
        // Previously a canned simulated report (with invented directives) was returned here and
        // labeled "live". A failed live audit is now reported honestly so no edits are forced.
        console.log(
          `[/api/audit] Live audit failed: ${auditModelErr instanceof Error ? auditModelErr.message : String(auditModelErr)}`
        );
        res.status(502).json({
          error: toFriendlyErrorMessage(auditModelErr, "The AI auditor is unavailable right now. Your script is unchanged."),
          mode: "live_audit_failed",
        });
        return;
      }

      const scores = [
        Number(parsedReport.metrics?.narrative_drive?.score || 0),
        Number(parsedReport.metrics?.spoken_cadence?.score || 0),
        Number(parsedReport.metrics?.tape_integration?.score || 0),
        Number(parsedReport.metrics?.investigative_authority?.score || 0),
        Number(parsedReport.metrics?.narrator_composure?.score || 0),
      ];
      const computedComposite = Number(
        scores.reduce((acc, val) => acc + val, 0).toFixed(1)
      );
      const computedMin = Number(Math.min(...scores).toFixed(1));

      const mergedForbidden = Array.from(
        new Set([
          ...(parsedReport.privacy_and_tag_audit
            ?.forbidden_domestic_phrases_found || []),
          ...privacyScan.forbidden_domestic_phrases_found,
        ])
      );
      const mergedHera =
        Boolean(parsedReport.privacy_and_tag_audit?.hera_references_found) ||
        privacyScan.hera_references_found;
      const mergedPrivacyGate =
        privacyScan.privacy_gate_passed &&
        mergedForbidden.length === 0 &&
        !mergedHera;

      const seenSectionIds = new Set<string>();
      const normalizedDirectives = (parsedReport.surgical_directives || [])
        .map((d) => {
          const resolved = resolveSectionById(parsed, d.section_id);
          if (!resolved || resolved.section_id === "APPENDIX") return null;
          if (!resolved.blocks.some((b) => b.type === "narrator")) return null;
          const key = resolved.section_id.toUpperCase();
          if (seenSectionIds.has(key)) return null;
          seenSectionIds.add(key);
          return {
            section_id: resolved.section_id,
            flaw: d.flaw,
            editorial_order: d.editorial_order,
          };
        })
        .filter((d): d is NonNullable<typeof d> => Boolean(d));

      // Inject deterministic Quote-Echo directives (objective, measurable repetition) if not already covered.
      // Cliffhanger signals are passed to the auditor as information only: the charter says not every
      // chapter needs a cliffhanger, so they no longer generate edits automatically.
      for (const echo of quoteEchoReport.echoes) {
        const key = echo.section_id.toUpperCase();
        if (!seenSectionIds.has(key) && normalizedDirectives.length < 4) {
          seenSectionIds.add(key);
          normalizedDirectives.push({
            section_id: echo.section_id,
            flaw: `Quote-Echo detected in ${echo.narrator_block_id} (${echo.repeated_phrases.join(", ")}).`,
            editorial_order: echo.editorial_fix_directive,
          });
        }
      }

      // Sort directives so sections not yet reviewed come first.
      normalizedDirectives.sort((a, b) => {
        const aPolished = polishedSet.has(a.section_id.toUpperCase()) ? 1 : 0;
        const bPolished = polishedSet.has(b.section_id.toUpperCase()) ? 1 : 0;
        return aPolished - bPolished;
      });

      // NOTE: the former "ensure at least 2 sections to polish" fallback was removed.
      // Zero directives means NO CHANGE REQUIRED, which is a valid editorial outcome.

      const cappedDirectives = normalizedDirectives.slice(0, 3);

      const passedThreshold =
        computedComposite >= targetScore &&
        computedMin >= 18 &&
        mergedPrivacyGate;

      const finalReport: AuditorReport = {
        ...parsedReport,
        pass_number: passNumber,
        privacy_and_tag_audit: {
          forbidden_domestic_phrases_found: mergedForbidden,
          hera_references_found: mergedHera,
          privacy_gate_passed: mergedPrivacyGate,
        },
        composite_score: computedComposite,
        min_category_score: computedMin,
        passed_threshold: passedThreshold,
        locked_acts: Array.isArray(lockedActs) ? lockedActs : [],
        surgical_directives: cappedDirectives,
      };

      res.json({
        report: finalReport,
        privacyScan,
        // Backward-compatible addition: story-level findings that informed this audit.
        narrative_report: narrativeReport,
        no_change_required: cappedDirectives.length === 0,
        mode: `live_${modelUsed}`,
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: toFriendlyErrorMessage(
          error,
          "Our AI writing assistant is momentarily busy. Please try again."
        ),
      });
    }
  });

  // Call 2 — Narrator Script Polisher
  app.post("/api/edit", async (req, res) => {
    try {
      const {
        manuscript = "",
        targetedSections = [],
        surgicalDirectives = [],
        lockedActs = [],
        pinnedBlockIds = [],
        simulate = false,
      } = req.body || {};

      const parsed = parseManuscript(manuscript);
      const pinnedSet = new Set<string>(
        Array.isArray(pinnedBlockIds) ? pinnedBlockIds : []
      );

      if (simulate || !hasValidApiKey()) {
        const simPatchData = getSimulatedEditorPatches();
        res.json({
          patchResponse: simPatchData,
          mode: simulate ? "simulated" : "fallback_simulated",
        });
        return;
      }

      const requestedIds = new Set<string>();
      for (const s of Array.isArray(targetedSections) ? targetedSections : []) {
        const resolved = resolveSectionById(parsed, s?.section_id);
        if (resolved) requestedIds.add(resolved.section_id.toUpperCase());
      }
      for (const d of Array.isArray(surgicalDirectives) ? surgicalDirectives : []) {
        const resolved = resolveSectionById(parsed, d?.section_id);
        if (resolved) requestedIds.add(resolved.section_id.toUpperCase());
      }

      const allEditableSections = parsed.sections.filter(
        (sec) =>
          sec.section_id !== "APPENDIX" &&
          sec.blocks.some((b) => b.type === "narrator" && !pinnedSet.has(b.id))
      );

      // Only sections the auditor actually flagged are edited. The former fallback that picked
      // the first two sections when nothing was requested forced edits and has been removed.
      const matchedSections = allEditableSections.filter((sec) =>
        requestedIds.has(sec.section_id.toUpperCase())
      );
      if (matchedSections.length === 0) {
        res.json({
          patchResponse: { narrator_patches: [], patched_sections: [], editor_changelog: ["NO CHANGE REQUIRED: no section was flagged for revision."] },
          mode: "no_change_required",
        });
        return;
      }

      const selectedSections = matchedSections.slice(0, 3);

      const sectionsContext = selectedSections.map((sec) => ({
        section_id: sec.section_id,
        title: sec.title,
        raw_section_markdown: sec.rawMarkdown,
      }));

      const editableNarratorBlocks = selectedSections.flatMap((sec) =>
        sec.blocks
          .filter((b) => b.type === "narrator" && !pinnedSet.has(b.id))
          .map((b) => ({
            section_id: sec.section_id,
            block_id: b.id,
            current_narrator_markdown: b.rawText,
          }))
      );

      console.log(
        `[/api/edit] Requested section IDs: [${Array.from(requestedIds).join(", ")}] -> Selected sections: [${selectedSections
          .map((s) => s.section_id)
          .join(", ")}]`
      );
      console.log(
        `[/api/edit] Sending ${editableNarratorBlocks.length} [Male Narrator] block(s) to Editor model:`,
        editableNarratorBlocks.map((b) => ({
          section_id: b.section_id,
          block_id: b.block_id,
          chars: b.current_narrator_markdown.length,
          preview: b.current_narrator_markdown.replace(/\s+/g, " ").slice(0, 80),
        }))
      );

      if (editableNarratorBlocks.length === 0) {
        console.warn("[/api/edit] 0 editable [Male Narrator] blocks found in manuscript.");
        res.json({
          patchResponse: {
            narrator_patches: [],
            patched_sections: [],
            editor_changelog: [],
          },
          mode: "noop",
        });
        return;
      }

      const ai = getGenAIClient();
      const userPrompt = `SURGICAL DIRECTIVES FROM SHOWRUNNER:
${JSON.stringify(surgicalDirectives, null, 2)}

SECTION CONTEXT (Read-Only Reference — DO NOT alter or include > blockquotes, [ARCHIVAL] cues, or # headings in your output):
${JSON.stringify(sectionsContext, null, 2)}

EDITABLE NARRATOR BLOCKS (Revise ONLY the blocks that need it to meet the directives. Omit blocks that already work. Use the exact section_id and block_id. Returning no patches is valid when nothing needs changing):
${JSON.stringify(editableNarratorBlocks, null, 2)}`;

      let rawNarratorPatches: Array<{
        section_id: string;
        block_id: string;
        updated_narrator_markdown: string;
      }> = [];
      let rawPatchedSections: Array<{
        section_id: string;
        updated_section_markdown: string;
      }> = [];
      let editorChangelog: string[] = [];
      let editModelUsed = "";
      let writerRole = "";

      type EditPayload = {
        narrator_patches?: Array<{ section_id: string; block_id: string; updated_narrator_markdown: string }>;
        patched_sections?: Array<{ section_id: string; updated_section_markdown: string }>;
        editor_changelog?: string[];
      };
      const takeEdit = (data: EditPayload) => {
        rawNarratorPatches = Array.isArray(data.narrator_patches) ? data.narrator_patches : [];
        rawPatchedSections = Array.isArray(data.patched_sections) ? data.patched_sections : [];
        editorChangelog = Array.isArray(data.editor_changelog) ? data.editor_changelog : [];
      };

      // Writer routing: ChatGPT (Codex CLI, ChatGPT subscription) writes when available, so the
      // Gemini auditor stays independent. RSRE_EDIT_WRITER=gemini forces the previous behavior.
      const writerPref = (process.env.RSRE_EDIT_WRITER || "auto").toLowerCase();
      const codex = writerPref === "gemini" ? null : checkCodexStatus();
      let writerFallbackNote = "";
      if (codex?.available) {
        try {
          const data = (await runCodexJson(`${EDITOR_SYSTEM_PROMPT}\n\n${userPrompt}\n\nDo not run tools or commands. Respond only with JSON.`, editorPatchJsonSchema())) as EditPayload;
          takeEdit(data);
          editModelUsed = "chatgpt_codex";
          writerRole = "ChatGPT writer (independent of the Gemini auditor)";
        } catch (codexErr) {
          writerFallbackNote = `ChatGPT writer failed (${codexErr instanceof Error ? codexErr.message.slice(0, 160) : "error"}); Gemini wrote this pass instead.`;
          console.log(`[/api/edit] ${writerFallbackNote}`);
        }
      } else if (codex) {
        writerFallbackNote = `ChatGPT writer unavailable (${codex.reason.slice(0, 200)}); Gemini wrote this pass.`;
      }

      if (!editModelUsed) {
        try {
          const liveEdit = await generateWithModelFallback<EditPayload>(ai, {
            contents: userPrompt,
            systemInstruction: EDITOR_SYSTEM_PROMPT,
            temperature: 0.35,
            responseSchema: EDITOR_RESPONSE_SCHEMA,
          });
          takeEdit(liveEdit.data);
          editModelUsed = liveEdit.modelUsed;
          writerRole = "Gemini writer (same provider as the auditor, NOT an independent review)";
        } catch (editModelErr) {
          // No deterministic "polish" is substituted: a failed writer means no edit this pass.
          console.log(`[/api/edit] Live edit failed: ${editModelErr instanceof Error ? editModelErr.message : String(editModelErr)}`);
          res.status(502).json({
            error: toFriendlyErrorMessage(editModelErr, "The AI writer is unavailable right now. Your script is unchanged."),
            mode: "live_edit_failed",
          });
          return;
        }
      }
      if (writerFallbackNote) editorChangelog.unshift(`[Writer routing] ${writerFallbackNote}`);

      console.log(
        `[/api/edit] Model (${editModelUsed}) returned ${rawNarratorPatches.length} narrator_patches and ${rawPatchedSections.length} patched_sections:`,
        rawNarratorPatches.map((p) => ({
          section_id: p?.section_id,
          block_id: p?.block_id,
          chars: p?.updated_narrator_markdown?.length ?? 0,
        }))
      );

      // Normalize section_id and block_id on each received narrator_patch against editableNarratorBlocks
      const usedTargetBlockIds = new Set<string>();
      const normalizedNarratorPatches: NarratorBlockPatch[] = [];

      for (let i = 0; i < rawNarratorPatches.length; i++) {
        const item = rawNarratorPatches[i];
        if (!item || typeof item.updated_narrator_markdown !== "string") {
          console.warn(`[/api/edit] Skipped malformed patch at index ${i}`);
          continue;
        }

        const rawSec = (item.section_id || "").trim();
        const rawBlk = (item.block_id || "").trim();

        // 1. Try exact block_id match against editableNarratorBlocks
        let matchedTarget = editableNarratorBlocks.find(
          (eb) =>
            !usedTargetBlockIds.has(eb.block_id) &&
            (eb.block_id.toUpperCase() === rawBlk.toUpperCase() ||
              eb.block_id.toUpperCase() ===
                `${eb.section_id.toUpperCase()}-${rawBlk.toUpperCase()}`)
        );

        // 2. If block_id didn't match directly, resolve section_id and pick the next unused narrator block in that section
        if (!matchedTarget) {
          const resolvedSec = resolveSectionById(parsed, rawSec);
          if (resolvedSec) {
            matchedTarget = editableNarratorBlocks.find(
              (eb) =>
                !usedTargetBlockIds.has(eb.block_id) &&
                eb.section_id.toUpperCase() === resolvedSec.section_id.toUpperCase()
            );
          }
        }

        // 3. Positional fallback across editableNarratorBlocks
        if (!matchedTarget && i < editableNarratorBlocks.length) {
          const candidate = editableNarratorBlocks[i];
          if (!usedTargetBlockIds.has(candidate.block_id)) {
            matchedTarget = candidate;
          }
        }

        if (matchedTarget) {
          usedTargetBlockIds.add(matchedTarget.block_id);
          normalizedNarratorPatches.push({
            section_id: matchedTarget.section_id,
            block_id: matchedTarget.block_id,
            updated_narrator_markdown: item.updated_narrator_markdown,
          });
        } else {
          const fallbackSec = resolveSectionById(parsed, rawSec);
          normalizedNarratorPatches.push({
            section_id: fallbackSec ? fallbackSec.section_id : rawSec,
            block_id: rawBlk,
            updated_narrator_markdown: item.updated_narrator_markdown,
          });
        }
      }

      // Fallback if the response used patched_sections instead of narrator_patches
      if (normalizedNarratorPatches.length === 0 && rawPatchedSections.length > 0) {
        const converted = convertSectionPatchesToNarratorPatches(
          manuscript,
          rawPatchedSections
        ).filter((p) => !pinnedSet.has(p.block_id));
        normalizedNarratorPatches.push(...converted);
      }

      const spliceCheck = applyNarratorPatches(
        manuscript,
        normalizedNarratorPatches,
        lockedActs,
        pinnedSet
      );

      // The former "guarantee every pass produces edits" deterministic polisher was removed.
      // If the writer returned identical text or no patches, that is NO CHANGE REQUIRED.
      if (!spliceCheck.anySectionChanged || spliceCheck.sectionDiffs.length === 0) {
        console.log(`[/api/edit] Writer proposed no effective change. NO CHANGE REQUIRED.`);
        res.json({
          patchResponse: {
            narrator_patches: [],
            patched_sections: [],
            editor_changelog: editorChangelog.length > 0 ? editorChangelog : ["NO CHANGE REQUIRED: the writer judged the flagged narration already effective."],
          },
          mode: `live_${editModelUsed}`,
          writer: writerRole,
          no_change_required: true,
        });
        return;
      }

      // Build canonical narrator_patches directly from the verified sectionDiffs so client and server stay 100% identical
      const verifiedCanonicalPatches: NarratorBlockPatch[] = [];
      for (const diff of spliceCheck.sectionDiffs) {
        const origSec = resolveSectionById(parsed, diff.section_id);
        if (!origSec) continue;
        const origNarratorBlocks = origSec.blocks.filter(
          (b) => b.type === "narrator"
        );
        origNarratorBlocks.forEach((b, idx) => {
          const afterText = diff.narratorBlocksAfter[idx];
          if (
            typeof afterText === "string" &&
            afterText.trim() !== b.rawText.trim() &&
            !pinnedSet.has(b.id)
          ) {
            verifiedCanonicalPatches.push({
              section_id: origSec.section_id,
              block_id: b.id,
              updated_narrator_markdown: afterText,
            });
          }
        });
      }

      const finalNarratorPatches =
        verifiedCanonicalPatches.length > 0
          ? verifiedCanonicalPatches
          : normalizedNarratorPatches;

      console.log(
        `[/api/edit] Splice complete: ${spliceCheck.sectionDiffs.length} section(s) modified, ${finalNarratorPatches.length} narrator block(s) swapped:`,
        spliceCheck.sectionDiffs.map((d) => ({
          section_id: d.section_id,
          deltaChars: d.deltaChars,
          narratorBlocksChanged: d.narratorBlocksAfter.length,
        }))
      );
      if (spliceCheck.guardrailEvents.length > 0) {
        console.log(`[/api/edit] Guardrail events:`, spliceCheck.guardrailEvents);
      }

      res.json({
        patchResponse: {
          narrator_patches: finalNarratorPatches,
          patched_sections: spliceCheck.sectionDiffs.map((d) => ({
            section_id: d.section_id,
            updated_section_markdown: d.afterMarkdown,
          })),
          editor_changelog:
            editorChangelog.length > 0
              ? editorChangelog
              : spliceCheck.sectionDiffs.map(
                  (d) =>
                    `Polished [Male Narrator] cadence and transitions in section ${d.section_id} (${
                      d.deltaChars >= 0 ? `+${d.deltaChars}` : d.deltaChars
                    } chars).`
                ),
        },
        mode: `live_${editModelUsed}`,
        writer: writerRole,
      });
    } catch (error: unknown) {
      console.error("[/api/edit] Error:", error);
      res.status(500).json({
        error: toFriendlyErrorMessage(
          error,
          "Our AI writing assistant encountered a hiccup while polishing narrator blocks. Please try again."
        ),
      });
    }
  });

  /**
   * POST /api/chat
   * Live AI Showrunner Co-Pilot & Spot-Review Chatbot.
   * Sees the full working script, all passes & diffs completed in the app, and can
   * answer any question, provide on-the-spot script reviews, and generate pre-validated
   * surgical [Male Narrator] block edits.
   */
  const COPILOT_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      reply_markdown: {
        type: Type.STRING,
        description:
          "Direct, helpful showrunner response to the user's question, review request, or surgical edit request.",
      },
      should_auto_apply: {
        type: Type.BOOLEAN,
        description:
          "True ONLY if the user explicitly asked to apply/perform an edit or rewrite right now; false if they asked a question or asked for a review.",
      },
      spot_review: {
        type: Type.OBJECT,
        nullable: true,
        description:
          "On-the-spot script or section review summary when the user asks for feedback, critique, review, or grading.",
        properties: {
          estimated_score: { type: Type.NUMBER },
          verdict: { type: Type.STRING },
          strengths: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          weak_spots: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["estimated_score", "verdict", "strengths", "weak_spots"],
      },
      proposed_patches: {
        type: Type.ARRAY,
        description:
          "Surgical [Male Narrator] block rewrites matched to exact section_id and block_id from AVAILABLE NARRATOR BLOCKS.",
        items: {
          type: Type.OBJECT,
          properties: {
            section_id: { type: Type.STRING },
            block_id: { type: Type.STRING },
            rationale: { type: Type.STRING },
            updated_narrator_markdown: { type: Type.STRING },
          },
          required: [
            "section_id",
            "block_id",
            "rationale",
            "updated_narrator_markdown",
          ],
        },
      },
    },
    required: ["reply_markdown", "should_auto_apply", "proposed_patches"],
  };

  app.post("/api/chat", async (req, res) => {
    try {
      const {
        message = "",
        history = [],
        manuscript = "",
        appStateSummary = {},
      } = req.body as {
        message?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        manuscript?: string;
        appStateSummary?: Record<string, unknown>;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Please enter a message or question." });
        return;
      }

      const parsed = parseManuscript(manuscript || "");
      const privacyCheck = scanPrivacyFence(manuscript || "");
      const pinnedIds = Array.isArray(appStateSummary?.pinnedBlockIds)
        ? new Set(appStateSummary.pinnedBlockIds as string[])
        : new Set<string>();

      const allNarratorBlocks: Array<{
        section_id: string;
        section_title: string;
        block_id: string;
        pinned: boolean;
        current_narrator_markdown: string;
      }> = [];

      const sectionsOverview = parsed.sections.map((sec) => {
        const narratorBlocks = sec.blocks.filter((b) => b.type === "narrator");
        for (const nb of narratorBlocks) {
          allNarratorBlocks.push({
            section_id: sec.section_id,
            section_title: sec.title,
            block_id: nb.id,
            pinned: pinnedIds.has(nb.id),
            current_narrator_markdown: nb.rawText,
          });
        }
        return {
          section_id: sec.section_id,
          header: sec.title,
          narrator_block_ids: narratorBlocks.map((b) => b.id),
          locked_quotes_and_cues: sec.blocks
            .filter((b) => b.type !== "narrator")
            .map((b) => ({
              type: b.type,
              text:
                b.rawText.length > 120
                  ? b.rawText.slice(0, 120) + "..."
                  : b.rawText,
            })),
        };
      });

      const asksToEdit =
        /\b(edit|rewrite|polish|tighten|punch|fix|change|replace|shorten|sharpen|cut|improve|update)\b/i.test(
          message
        );
      const asksForReview =
        /\b(review|critique|grade|score|feedback|how does|weakest|strongest|thoughts|analyze|audit|what do you think)\b/i.test(
          message
        );

      const buildFallbackCopilotResponse = () => {
        // Identify any section IDs explicitly mentioned by the user (e.g., A101, A204)
        const mentionedSectionIds = parsed.sections
          .filter((s) =>
            new RegExp(`\\b${s.section_id}\\b`, "i").test(message)
          )
          .map((s) => s.section_id);

        const targetSectionIds =
          mentionedSectionIds.length > 0
            ? mentionedSectionIds
            : parsed.sections.slice(0, 2).map((s) => s.section_id);

        const detPatches = buildDeterministicNarratorPatches(
          manuscript,
          targetSectionIds,
          pinnedIds
        );

        const validatedPatches = detPatches.map((p) => {
          const origBlock = allNarratorBlocks.find(
            (b) => b.block_id === p.block_id
          );
          return {
            section_id: p.section_id,
            block_id: p.block_id,
            rationale:
              "Tightened spoken cadence, cut hedging qualifiers, and sharpened the lead-in before primary tape.",
            before_markdown: origBlock?.current_narrator_markdown || "",
            updated_narrator_markdown: p.updated_narrator_markdown,
          };
        });

        return {
          reply_markdown: asksToEdit
            ? `I reviewed your current draft (${parsed.sections.length} sections, ${allNarratorBlocks.length} \`[Male Narrator]\` blocks) and prepared **${validatedPatches.length} surgical narrator edit(s)** targeting **${targetSectionIds.join(", ")}**.\n\nEvery edit tightens the spoken-word cadence to a *Serial* / *Pretend* standard while keeping all \`>\` quotes and \`[ARCHIVAL]\` cues 100% locked.`
            : `### On-The-Spot Showrunner Review\n\nYour script currently spans **${parsed.sections.length} sections** with **${allNarratorBlocks.length} \`[Male Narrator]\` blocks** and **Privacy Fence: ${privacyCheck.privacy_gate_passed ? "PASS" : "FAIL"}**.\n\n- **What's Working Well:** Your primary evidence blocks (\`>\` quotes and \`[ARCHIVAL]\` cues) establish a clear timeline and strong documentary receipts.\n- **Where to Tighten Next:** In **${targetSectionIds.join(" & ")}**, the \`[Male Narrator]\` setups can step out of the way faster before the tape plays and land with a drier, more decisive \`[Beat]\` on the exit.\n\nI've included **${validatedPatches.length} surgical edit suggestion(s)** below that you can apply with one click.`,
          should_auto_apply: asksToEdit,
          spot_review: {
            estimated_score: 88.5,
            verdict:
              "Strong evidentiary spine with clear investigative authority; narrator setups in early sections can be tightened for faster spoken rhythm.",
            strengths: [
              "Primary quotes and archival cues provide concrete timeline verification.",
              "Narrator persona remains composed and focused on documented methodology.",
            ],
            weak_spots: [
              `Sections ${targetSectionIds.join(", ")} have narrator lines that can be trimmed for punchier broadcast delivery.`,
              "Adding deliberate [Beat] pauses right after archival clips will let the tape land harder.",
            ],
          },
          proposed_patches: validatedPatches,
          mode: "simulated_copilot",
        };
      };

      if (!hasValidApiKey()) {
        res.json(buildFallbackCopilotResponse());
        return;
      }

      const ai = getGenAIClient();
      const recentHistoryText = Array.isArray(history)
        ? history
            .slice(-8)
            .map(
              (m) =>
                `${m.role === "user" ? "USER" : "CO-PILOT"}: ${m.content}`
            )
            .join("\n\n")
        : "";

      const mentionedSecSet = new Set(
        parsed.sections
          .filter((s) =>
            new RegExp(`\\b${s.section_id}\\b`, "i").test(message)
          )
          .map((s) => s.section_id.toUpperCase())
      );

      const relevantNarratorBlocks = allNarratorBlocks.map((b, idx) => {
        const isTarget =
          mentionedSecSet.size === 0
            ? idx < 8
            : mentionedSecSet.has(b.section_id.toUpperCase());
        return {
          section_id: b.section_id,
          section_title: b.section_title,
          block_id: b.block_id,
          pinned: b.pinned,
          current_narrator_markdown: isTarget
            ? b.current_narrator_markdown
            : b.current_narrator_markdown.slice(0, 160) + "...",
        };
      });

      const promptPayload = `LIVE APP WORKSPACE STATE (Passes, Scores, Diffs, Guardrails):
${JSON.stringify(
  {
    ...appStateSummary,
    total_sections: parsed.sections.length,
    total_narrator_blocks: allNarratorBlocks.length,
    privacy_gate_passed: privacyCheck.privacy_gate_passed,
    privacy_violations: privacyCheck.violations,
  },
  null,
  2
)}

SCRIPT SECTIONS OVERVIEW:
${JSON.stringify(sectionsOverview, null, 2)}

AVAILABLE NARRATOR BLOCKS:
${JSON.stringify(relevantNarratorBlocks, null, 2)}

RECENT CONVERSATION HISTORY:
${recentHistoryText || "(Start of conversation)"}

USER REQUEST:
${message}`;

      try {
        const { data: copilotRes, modelUsed } =
          await generateWithModelFallback<{
            reply_markdown?: string;
            should_auto_apply?: boolean;
            spot_review?: {
              estimated_score: number;
              verdict: string;
              strengths: string[];
              weak_spots: string[];
            } | null;
            proposed_patches?: Array<{
              section_id: string;
              block_id: string;
              rationale: string;
              updated_narrator_markdown: string;
            }>;
          }>(ai, {
            contents: promptPayload,
            systemInstruction: COPILOT_SYSTEM_PROMPT,
            temperature: 0.35,
            responseSchema: COPILOT_RESPONSE_SCHEMA,
          });

        // Normalize and deterministically validate proposed_patches against current manuscript
        const rawPatches = Array.isArray(copilotRes.proposed_patches)
          ? copilotRes.proposed_patches
          : [];
        const usedIds = new Set<string>();
        const validatedProposedPatches: Array<{
          section_id: string;
          block_id: string;
          rationale: string;
          before_markdown: string;
          updated_narrator_markdown: string;
        }> = [];

        for (const item of rawPatches) {
          if (!item || typeof item.updated_narrator_markdown !== "string") {
            continue;
          }
          const rawSec = (item.section_id || "").trim();
          const rawBlk = (item.block_id || "").trim();

          let target = allNarratorBlocks.find(
            (b) =>
              !usedIds.has(b.block_id) &&
              !b.pinned &&
              (b.block_id.toUpperCase() === rawBlk.toUpperCase() ||
                b.block_id.toUpperCase() ===
                  `${b.section_id.toUpperCase()}-${rawBlk.toUpperCase()}`)
          );

          if (!target) {
            const resolvedSec = resolveSectionById(parsed, rawSec);
            if (resolvedSec) {
              target = allNarratorBlocks.find(
                (b) =>
                  !usedIds.has(b.block_id) &&
                  !b.pinned &&
                  b.section_id.toUpperCase() ===
                    resolvedSec.section_id.toUpperCase()
              );
            }
          }

          if (!target) continue;

          // Verify single-block splice safety against deterministic guardrails
          const singleSplice = applyNarratorPatches(
            manuscript,
            [
              {
                section_id: target.section_id,
                block_id: target.block_id,
                updated_narrator_markdown: item.updated_narrator_markdown,
              },
            ],
            [],
            pinnedIds
          );

          if (
            singleSplice.anySectionChanged &&
            singleSplice.sectionDiffs.length > 0 &&
            verifyCueIntegrity(manuscript, singleSplice.assembledMarkdown)
              .tag_integrity &&
            scanPrivacyFence(singleSplice.assembledMarkdown).privacy_gate_passed
          ) {
            usedIds.add(target.block_id);
            const cleanedNarratorText = item.updated_narrator_markdown
              .trim()
              .startsWith("[")
              ? item.updated_narrator_markdown.trim()
              : `[Male Narrator]\n${item.updated_narrator_markdown.trim()}`;

            validatedProposedPatches.push({
              section_id: target.section_id,
              block_id: target.block_id,
              rationale:
                item.rationale ||
                "Sharpened spoken cadence and investigative authority.",
              before_markdown: target.current_narrator_markdown,
              updated_narrator_markdown: cleanedNarratorText,
            });
          }
        }

        // Zero valid patches is reported as-is. Rule-based filler patches are no longer substituted.

        res.json({
          reply_markdown:
            copilotRes.reply_markdown ||
            "Here is my analysis and surgical recommendations for your script.",
          should_auto_apply: Boolean(
            copilotRes.should_auto_apply && validatedProposedPatches.length > 0
          ),
          spot_review:
            copilotRes.spot_review ||
            (asksForReview ? buildFallbackCopilotResponse().spot_review : null),
          proposed_patches: validatedProposedPatches,
          mode: `live_${modelUsed}`,
        });
      } catch (modelErr: unknown) {
        console.log(
          `[/api/chat] Engaging deterministic copilot response (${modelErr instanceof Error ? modelErr.message : "fallback mode"})`
        );
        res.json(buildFallbackCopilotResponse());
      }
    } catch (error: unknown) {
      console.error("[/api/chat] Error:", error);
      res.status(500).json({
        error: toFriendlyErrorMessage(
          error,
          "Our AI Script Co-Pilot encountered a hiccup. Please try again."
        ),
      });
    }
  });

  /**
   * POST /api/variants
   * Generates 3 distinct Showrunner Rewrite Variants for any clicked [Male Narrator] block:
   * 1. Dry & Minimalist (let the tape do 90% of the work)
   * 2. Investigative & Forensic (emphasize timeline contradictions and receipts)
   * 3. Conversational Serial Cadence (rhythmic, reflective, first-person storytelling)
   */
  const VARIANTS_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      variants: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            style_id: { type: Type.STRING },
            style_label: { type: Type.STRING },
            tagline: { type: Type.STRING },
            updated_narrator_markdown: { type: Type.STRING },
          },
          required: [
            "style_id",
            "style_label",
            "tagline",
            "updated_narrator_markdown",
          ],
        },
      },
    },
    required: ["variants"],
  };

  app.post("/api/variants", async (req, res) => {
    try {
      const {
        manuscript = "",
        sectionId = "",
        blockId = "",
        narratorMarkdown = "",
      } = req.body as {
        manuscript?: string;
        sectionId?: string;
        blockId?: string;
        narratorMarkdown?: string;
      };

      const parsed = parseManuscript(manuscript);
      const sec = resolveSectionById(parsed, sectionId);
      const targetBlock =
        sec?.blocks.find((b) => b.id === blockId && b.type === "narrator") ||
        sec?.blocks.find((b) => b.type === "narrator");

      const sourceText =
        narratorMarkdown.trim() || targetBlock?.rawText || "[Male Narrator]";
      const origWords = sourceText
        .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

      const deterministicFallback =
        generateDeterministicShowrunnerVariants(sourceText);

      if (!hasValidApiKey()) {
        res.json({
          section_id: sec?.section_id || sectionId,
          block_id: targetBlock?.id || blockId,
          variants: deterministicFallback,
          mode: "deterministic_variants",
        });
        return;
      }

      const ai = getGenAIClient();
      const prompt = `SECTION CONTEXT (${sec?.section_id || sectionId} — "${sec?.title || ""}"):
${sec?.rawMarkdown || sourceText}

TARGET [Male Narrator] BLOCK (${targetBlock?.id || blockId}):
${sourceText}

Generate 4 distinct Showrunner rewrite variants of this single [Male Narrator] block, prioritizing Option D as the primary signature standard:

1. style_id: "paper_trail_signature", style_label: "Option D — Signature Style (Default)", tagline: "Conversational Investigative Storytelling in Logan's authentic voice" — THE PERMANENT DEFAULT. Natural, believable narration in Logan Black's authentic voice: conversational, intelligent, direct, skeptical, personally involved, occasionally blunt, and unpretentious. Clear storytelling with enough context for an audio-only audience. Original recordings introduced at the exact moment they have the greatest impact without spoiling them. Contradictions revealed through the unfolding narrative. Zero manufactured drama.
2. style_id: "dry_minimalist", style_label: "Option A — Dry & Minimalist", tagline: "Let the primary tape do the work" — Ultra-lean, cuts all throat-clearing, steps aside in 1-2 crisp sentences.
3. style_id: "investigative_forensic", style_label: "Option B — Forensic & Investigative", tagline: "Focus on timeline contradictions without manufactured drama" — Grounded timeline and document focus. Strictly sticks to actual evidence; NEVER invents keycards, terminals, or unverified physical presence.
4. style_id: "serial_cadence", style_label: "Option C — Conversational Serial Cadence", tagline: "Rhythmic, reflective first-person storytelling" — Natural spoken rhythm and reflective pacing.

CRITICAL FACTUAL INTEGRITY RULE:
You MUST NOT invent unestablished facts, fake keycards, terminal numbers, or unverified physical presence. A good showrunner identifies manufactured facts as fatal editorial errors. Every line must sound like Logan Black speaking naturally into a broadcast mic.

Every updated_narrator_markdown MUST start with [Male Narrator] and MUST NOT include any > blockquotes, [ARCHIVAL] cues, or # headings.`;

      try {
        const { data, modelUsed } = await generateWithModelFallback<{
          variants?: Array<{
            style_id: string;
            style_label: string;
            tagline: string;
            updated_narrator_markdown: string;
          }>;
        }>(ai, {
          contents: prompt,
          systemInstruction: EDITOR_SYSTEM_PROMPT,
          temperature: 0.45,
          responseSchema: VARIANTS_RESPONSE_SCHEMA,
        });

        const rawList = Array.isArray(data.variants) ? data.variants : [];
        const stylesOrder: Array<ShowrunnerVariantItem["style_id"]> = [
          "paper_trail_signature",
          "dry_minimalist",
          "investigative_forensic",
          "serial_cadence",
        ];

        const finalVariants: ShowrunnerVariantItem[] = stylesOrder.map(
          (styleId, idx) => {
            const matched =
              rawList.find((v) => v?.style_id === styleId) || rawList[idx];
            const fallbackItem = deterministicFallback[idx] || deterministicFallback[0];
            if (
              !matched ||
              typeof matched.updated_narrator_markdown !== "string" ||
              !matched.updated_narrator_markdown.trim()
            ) {
              return fallbackItem;
            }
            const formattedText = matched.updated_narrator_markdown
              .trim()
              .startsWith("[")
              ? matched.updated_narrator_markdown.trim()
              : `[Male Narrator]\n${matched.updated_narrator_markdown.trim()}`;

            // Verify against guardrails
            if (
              /^>\s*/m.test(formattedText) ||
              /\[ARCHIVAL/i.test(formattedText) ||
              !scanPrivacyFence(formattedText).privacy_gate_passed
            ) {
              return fallbackItem;
            }

            const newWords = formattedText
              .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
              .trim()
              .split(/\s+/)
              .filter(Boolean).length;

            return {
              style_id: styleId,
              style_label: fallbackItem.style_label,
              tagline: matched.tagline || fallbackItem.tagline,
              updated_narrator_markdown: formattedText,
              word_count_delta: newWords - origWords,
              is_default: styleId === "paper_trail_signature",
            };
          }
        );

        res.json({
          section_id: sec?.section_id || sectionId,
          block_id: targetBlock?.id || blockId,
          variants: finalVariants,
          mode: `live_${modelUsed}`,
        });
      } catch {
        res.json({
          section_id: sec?.section_id || sectionId,
          block_id: targetBlock?.id || blockId,
          variants: deterministicFallback,
          mode: "fallback_variants",
        });
      }
    } catch (error: unknown) {
      res.status(500).json({
        error: toFriendlyErrorMessage(
          error,
          "Could not generate paragraph variants."
        ),
      });
    }
  });

  /**
   * POST /api/section-action
   * Executes a targeted one-click inline action on a single section:
   * - "polish": Polish Just This Section to Serial/Pretend standard
   * - "cut_25": Cut Narrator Word Count by ~25%
   * - "sharpen_lead_in": Eliminate Quote-Echoes & Sharpen Lead-Ins/Exits around primary tape
   */
  app.post("/api/section-action", async (req, res) => {
    try {
      const {
        manuscript = "",
        sectionId = "",
        action = "polish",
        pinnedBlockIds = [],
      } = req.body as {
        manuscript?: string;
        sectionId?: string;
        action?: "polish" | "cut_25" | "sharpen_lead_in";
        pinnedBlockIds?: string[];
      };

      const parsed = parseManuscript(manuscript);
      const sec = resolveSectionById(parsed, sectionId);
      if (!sec) {
        res.status(404).json({ error: `Section ${sectionId} not found.` });
        return;
      }

      const pinnedSet = new Set(pinnedBlockIds);
      const editableBlocks = sec.blocks
        .filter((b) => b.type === "narrator" && !pinnedSet.has(b.id))
        .map((b) => ({
          section_id: sec.section_id,
          block_id: b.id,
          current_narrator_markdown: b.rawText,
        }));

      if (editableBlocks.length === 0) {
        res.json({
          narrator_patches: [],
          action_summary: `All narrator paragraphs in ${sec.section_id} are currently locked/pinned.`,
        });
        return;
      }

      const actionDirectiveMap: Record<
        "polish" | "cut_25" | "sharpen_lead_in",
        string
      > = {
        polish:
          "Polish every [Male Narrator] block in this section to THE PAPER TRAIL Signature Style (Option D): Logan Black's authentic conversational voice—direct, intelligent, skeptical, personal, understated. Zero manufactured drama. Never invent unverified facts.",
        cut_25:
          "Trim narrator word count across every [Male Narrator] block in this section while preserving Logan's natural speaking voice and every factual anchor.",
        sharpen_lead_in:
          "Eliminate repetitive quote-echoes while keeping necessary speaker orientation. Let the original recording carry the emotional weight.",
      };

      const buildDeterministicActionPatches = (): NarratorBlockPatch[] => {
        return editableBlocks.map((eb) => {
          const variants = generateDeterministicShowrunnerVariants(
            eb.current_narrator_markdown
          );
          // Option D (index 0) is the signature default; Option A (index 1) is dry/cut
          const chosen = action === "cut_25" ? variants[1] : variants[0];
          return {
            section_id: eb.section_id,
            block_id: eb.block_id,
            updated_narrator_markdown: chosen.updated_narrator_markdown,
          };
        });
      };

      if (!hasValidApiKey()) {
        res.json({
          narrator_patches: buildDeterministicActionPatches(),
          action_summary: `Offline mode (no API key): applied rule-based '${action}' to ${editableBlocks.length} narrator block(s) in [${sec.section_id}]. Not AI-written.`,
          mode: "offline_deterministic",
        });
        return;
      }

      const ai = getGenAIClient();
      const prompt = `TARGET SECTION: ${sec.section_id} ("${sec.title}")
DIRECTIVE FOR THIS SECTION:
${actionDirectiveMap[action] || actionDirectiveMap.polish}

SECTION CONTEXT (Read-Only Reference — DO NOT alter or include > blockquotes, [ARCHIVAL] cues, or # headings):
${sec.rawMarkdown}

EDITABLE NARRATOR BLOCKS (Apply the directive to each block that needs it; omit blocks that already satisfy it. Use the exact section_id and block_id):
${JSON.stringify(editableBlocks, null, 2)}`;

      try {
        const { data: parsedRes } = await generateWithModelFallback<{
          narrator_patches?: Array<{
            section_id: string;
            block_id: string;
            updated_narrator_markdown: string;
          }>;
          editor_changelog?: string[];
        }>(ai, {
          contents: prompt,
          systemInstruction: EDITOR_SYSTEM_PROMPT,
          temperature: 0.35,
          responseSchema: EDITOR_RESPONSE_SCHEMA,
        });

        const rawPatches = Array.isArray(parsedRes.narrator_patches)
          ? parsedRes.narrator_patches
          : [];
        // Blocks the model did not return stay exactly as they are (no rule-based substitute).
        const normalized: NarratorBlockPatch[] = editableBlocks.flatMap((eb) => {
          const match = rawPatches.find(
            (p) => p?.block_id?.toUpperCase() === eb.block_id.toUpperCase()
          );
          if (
            match &&
            typeof match.updated_narrator_markdown === "string" &&
            match.updated_narrator_markdown.trim() &&
            match.updated_narrator_markdown.trim() !== eb.current_narrator_markdown.trim()
          ) {
            return [{
              section_id: sec.section_id,
              block_id: eb.block_id,
              updated_narrator_markdown: match.updated_narrator_markdown,
            }];
          }
          return [];
        });

        res.json({
          narrator_patches: normalized,
          action_summary:
            normalized.length === 0
              ? `NO CHANGE REQUIRED: the writer left every narrator block in [${sec.section_id}] as is.`
              : parsedRes.editor_changelog?.[0] ||
                `Revised ${normalized.length} of ${editableBlocks.length} narrator block(s) in [${sec.section_id}].`,
          mode: "live",
        });
      } catch (actionErr) {
        res.status(502).json({
          error: toFriendlyErrorMessage(actionErr, "The AI writer is unavailable right now. Your script is unchanged."),
          mode: "live_action_failed",
        });
      }
    } catch (error: unknown) {
      res.status(500).json({
        error: toFriendlyErrorMessage(
          error,
          "Could not run inline section action."
        ),
      });
    }
  });

  // ==========================================================================
  // NARRATIVE INTELLIGENCE ENGINE
  // ==========================================================================

  const kb = PAPER_TRAIL_KNOWLEDGE;

  const resolveWriter = (): { writer: WriterProvider | null; reason: string } => {
    if (options.narrativeProviders?.writer) {
      const w = options.narrativeProviders.writer();
      return { writer: w, reason: w ? "injected" : "Writer unavailable (injected)." };
    }
    const status = checkCodexStatus();
    return status.available ? { writer: createCodexWriter(), reason: status.reason } : { writer: null, reason: status.reason };
  };

  const resolveCritic = (): { critic: CriticProvider | null; reason: string } => {
    if (options.narrativeProviders?.critic) {
      const c = options.narrativeProviders.critic();
      return { critic: c, reason: c ? "injected" : "Critic unavailable (injected)." };
    }
    // Critic route: "antigravity" (Google sign-in, Gemini 3.8 Flash, chosen by the user) or "gemini-api" (API key, Pro only).
    const route = (process.env.RSRE_CRITIC_PROVIDER || "antigravity").toLowerCase();
    if (route === "antigravity") {
      const agy = checkAgyStatus();
      if (agy.available) return { critic: createAntigravityCritic(), reason: agy.reason };
      return { critic: null, reason: `${agy.reason} (Set RSRE_CRITIC_PROVIDER=gemini-api to use the API key instead.)` };
    }
    if (!hasValidApiKey()) return { critic: null, reason: "GEMINI_API_KEY is not configured." };
    const ai = getGenAIClient();
    return {
      critic: createGeminiCritic((o) =>
        generateWithModelFallback<unknown>(ai, { ...o, candidates: CRITIC_MODEL_CANDIDATES, thinkingLevel: ThinkingLevel.HIGH })
      ),
      reason: `Gemini Pro models only: ${CRITIC_MODEL_CANDIDATES.join(", ")}.`,
    };
  };

  /** Builds (incrementally, from the last stored version) and persists the story model and listener timeline. */
  const analyzeAndPersist = (manuscript: string): { model: StoryModel; timeline: ListenerTimeline } => {
    const latest = narrativeStore.loadLatest();
    const prevModel = latest.model_version_id ? narrativeStore.loadJson<StoryModel>("models", latest.model_version_id) : null;
    const prevTimeline = latest.listener_version_id ? narrativeStore.loadJson<ListenerTimeline>("listener", latest.listener_version_id) : null;
    const versionId = manuscriptVersionId(manuscript);
    const existing = narrativeStore.loadJson<StoryModel>("models", versionId);
    const model = existing && existing.project_id === kb.project_id ? existing : buildStoryModel(manuscript, kb, prevModel);
    const existingTimeline = narrativeStore.loadJson<ListenerTimeline>("listener", versionId);
    const timeline = existingTimeline || simulateListenerTimeline(manuscript, kb, model, prevTimeline);
    narrativeStore.saveJson("models", versionId, model);
    narrativeStore.saveJson("listener", versionId, timeline);
    narrativeStore.saveLatest({ model_version_id: versionId, listener_version_id: versionId });
    return { model, timeline };
  };

  app.get("/api/narrative/providers", (_req, res) => {
    const w = resolveWriter();
    const c = resolveCritic();
    const codex = options.narrativeProviders?.writer ? null : checkCodexStatus();
    res.json({
      writer: w.writer
        ? { ...w.writer.identity, available: true, reason: w.reason }
        : { provider_id: "chatgpt-codex", display_name: "ChatGPT (Codex CLI)", role: "writer", kind: "live", available: false, reason: w.reason },
      critic: c.critic
        ? { ...c.critic.identity, available: true, reason: c.reason }
        : { provider_id: "gemini", display_name: "Gemini (independent critic)", role: "critic", kind: "live", available: false, reason: c.reason },
      codex_diagnostics: codex ? { checked: codex.checked, last_live_call: codex.last_live_call } : null,
      notes: [
        "The editorial loop requires BOTH a ChatGPT writer and a Gemini critic. It never substitutes Gemini for the writer.",
        "Deterministic Narrative Intelligence (architecture, listener model, openings lab) works without any provider.",
      ],
    });
  });

  app.post("/api/narrative/analyze", (req, res) => {
    try {
      const { manuscript } = req.body || {};
      if (!manuscript || typeof manuscript !== "string") {
        res.status(400).json({ error: "Please provide a manuscript." });
        return;
      }
      const { model, timeline } = analyzeAndPersist(manuscript);
      const deterministic = buildDeterministicNarrativeReport(model, timeline);
      const critic = narrativeStore.loadJson("reports", model.manuscript_version_id);
      res.json({ model, timeline, deterministic_report: deterministic, critic_report: critic });
    } catch (error: unknown) {
      res.status(500).json({ error: toFriendlyErrorMessage(error, "Narrative analysis failed.") });
    }
  });

  /** One independent Gemini story review of the current version (cached by version). */
  app.post("/api/narrative/review", async (req, res) => {
    try {
      const { manuscript, force = false } = req.body || {};
      if (!manuscript || typeof manuscript !== "string") {
        res.status(400).json({ error: "Please provide a manuscript." });
        return;
      }
      const { model, timeline } = analyzeAndPersist(manuscript);
      const cached = narrativeStore.loadJson("reports", model.manuscript_version_id);
      if (cached && !force) {
        res.json({ report: cached, cached: true });
        return;
      }
      const { critic, reason } = resolveCritic();
      if (!critic) {
        res.status(409).json({ error: `Critic unavailable: ${reason}` });
        return;
      }
      const sceneIds = model.scenes.map((s) => s.scene_id);
      const raw = await critic.evaluate({
        manuscript_version_id: model.manuscript_version_id,
        scope: "full",
        story_digest: buildStoryDigest(model),
        listener_digest: buildListenerDigest(timeline),
        scenes: parseManuscript(manuscript).sections.filter((s) => s.section_id !== "APPENDIX").map((s) => ({ scene_id: s.section_id, title: s.title, markdown: s.rawMarkdown })),
        scene_order: sceneIds,
      });
      const normalized = normalizeNarrativeReport(raw, model.manuscript_version_id, { provider_id: critic.identity.provider_id, model: critic.identity.model, kind: critic.identity.kind }, sceneIds);
      if (!normalized.complete) {
        res.status(502).json({ error: `Critic returned an incomplete report: ${normalized.problems.join("; ")}` });
        return;
      }
      // Persist scene roles as semantic annotations keyed by scene content hash (reused while scenes are unchanged).
      const annotations: SceneSemantic[] = normalized.report.scene_findings
        .filter((f) => f.role)
        .map((f) => {
          const node = model.scenes.find((s) => s.scene_id === f.scene_id)!;
          return {
            scene_content_hash: node.content_hash, scene_id: node.scene_id, provider_id: critic.identity.provider_id, model: critic.identity.model,
            kind: critic.identity.kind, created_at: new Date().toISOString(), scene_purpose: f.finding.slice(0, 240), dramatic_question: "",
            stakes: "", role_assessment: f.role, character_development: [], opportunities: [], confidence: normalized.report.confidence.overall,
          };
        });
      narrativeStore.saveJson("models", model.manuscript_version_id, attachSemantic(model, annotations));
      narrativeStore.saveJson("reports", model.manuscript_version_id, normalized.report);
      narrativeStore.appendHistory({ event: "critic_review", version: model.manuscript_version_id, provider: critic.identity.provider_id, model: critic.identity.model });
      res.json({ report: normalized.report, cached: false, problems: normalized.problems });
    } catch (error: unknown) {
      res.status(502).json({ error: toFriendlyErrorMessage(error, "The critic is unavailable right now.") });
    }
  });

  /**
   * Selective, incremental AI listener predictions. Scenes are processed strictly in order; each
   * call receives only leak-checked audible material up to that scene.
   */
  app.post("/api/narrative/listener", async (req, res) => {
    try {
      const { manuscript, max_calls = 3, scene_ids } = req.body || {};
      if (!manuscript || typeof manuscript !== "string") {
        res.status(400).json({ error: "Please provide a manuscript." });
        return;
      }
      const { critic, reason } = resolveCritic();
      if (!critic || !critic.predictListener) {
        res.status(409).json({ error: `Listener simulation unavailable: ${reason}` });
        return;
      }
      let { model, timeline } = analyzeAndPersist(manuscript);
      const wanted = Array.isArray(scene_ids) && scene_ids.length > 0 ? new Set((scene_ids as string[]).map((s) => s.toUpperCase())) : null;
      const pending = scenesNeedingPrediction(timeline).filter((i) => !wanted || wanted.has(timeline.states[i].scene_id.toUpperCase()));
      const budget = Math.max(0, Math.min(12, Number(max_calls) || 0));
      const done: string[] = [];
      const blocked: Array<{ scene_id: string; reason: string }> = [];
      for (const i of pending.slice(0, budget)) {
        const ctx = buildListenerContext(manuscript, kb, i, timeline, model);
        const leaks = verifyListenerIsolation(ctx, manuscript, kb);
        if (leaks.length > 0) {
          blocked.push({ scene_id: ctx.scene_id, reason: leaks.map((l) => l.detail).join("; ") });
          continue;
        }
        const raw = (await critic.predictListener(ctx)) as Record<string, unknown>;
        const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
        const s = (v: unknown) => (typeof v === "string" ? v : "");
        const prediction: ListenerPrediction = {
          provider_id: critic.identity.provider_id, model: critic.identity.model, kind: critic.identity.kind, created_at: new Date().toISOString(),
          inferred: strs(raw.inferred), curiosity: s(raw.curiosity), anticipation: s(raw.anticipation), emotional_investment: s(raw.emotional_investment),
          fatigue_risk: s(raw.fatigue_risk), confusion: strs(raw.confusion), motivation_to_continue: s(raw.motivation_to_continue),
          primary_question: s(raw.primary_question),
          disclaimer: "AI prediction of a hypothetical first-time listener. Not an audience measurement.",
        };
        timeline = attachPrediction(timeline, ctx.scene_id, prediction);
        done.push(ctx.scene_id);
      }
      narrativeStore.saveJson("listener", model.manuscript_version_id, timeline);
      narrativeStore.appendHistory({ event: "listener_predictions", version: model.manuscript_version_id, scenes: done, blocked });
      res.json({ timeline, predicted_scenes: done, blocked, remaining: Math.max(0, pending.length - done.length - blocked.length) });
    } catch (error: unknown) {
      res.status(502).json({ error: toFriendlyErrorMessage(error, "Listener simulation failed.") });
    }
  });

  /** Runs the ChatGPT writer / Gemini critic editorial loop. Produces a STAGED candidate only. */
  app.post("/api/narrative/run", async (req, res) => {
    try {
      const { manuscript, expected_base_version_id, config = {}, pinnedBlockIds = [], lockedSceneIds = [] } = req.body || {};
      if (!manuscript || typeof manuscript !== "string") {
        res.status(400).json({ error: "Please provide a manuscript." });
        return;
      }
      const { writer, reason: writerReason } = resolveWriter();
      const { critic, reason: criticReason } = resolveCritic();
      if (!writer || !critic) {
        res.status(409).json({
          error: "The editorial loop needs both providers. It will not substitute one model for the other.",
          writer_available: Boolean(writer),
          writer_reason: writerReason,
          critic_available: Boolean(critic),
          critic_reason: criticReason,
        });
        return;
      }
      const { model } = analyzeAndPersist(manuscript);
      const safeConfig: Partial<OrchestratorConfig> = {};
      for (const k of ["max_iterations", "max_model_calls", "max_estimated_tokens", "narrative_threshold", "craft_threshold"] as const) {
        if (typeof config[k] === "number" && Number.isFinite(config[k])) safeConfig[k] = config[k];
      }
      safeConfig.max_iterations = Math.min(5, safeConfig.max_iterations ?? 3);
      safeConfig.max_model_calls = Math.min(12, safeConfig.max_model_calls ?? 8);

      const result = await runEditorialOrchestration({
        master_markdown: manuscript,
        expected_base_version_id,
        knowledge: kb,
        writer,
        critic,
        config: safeConfig,
        pinned_block_ids: pinnedBlockIds,
        locked_scene_ids: lockedSceneIds,
        previous_model: model,
        onProgress: (m) => console.log(`[narrative/run] ${m}`),
      });
      narrativeStore.saveJson("runs", result.run_id, result);
      if (result.candidate) narrativeStore.saveJson("candidates", result.candidate.candidate_id, result.candidate);
      if (result.final_report) narrativeStore.saveJson("reports", result.final_report.manuscript_version_id, result.final_report);
      narrativeStore.appendHistory({
        event: "editorial_run", run_id: result.run_id, base: result.base_version_id, stop: result.stop_reason,
        candidate: result.candidate?.candidate_id || null, calls: result.calls_used, writer: result.writer.provider_id, critic: result.critic.provider_id,
      });
      res.json(result);
    } catch (error: unknown) {
      res.status(500).json({ error: toFriendlyErrorMessage(error, "The editorial run failed. The master manuscript is unchanged.") });
    }
  });

  app.get("/api/narrative/candidates", (_req, res) => {
    const list = narrativeStore
      .listIds("candidates")
      .map((id) => narrativeStore.loadJson<ManuscriptCandidate>("candidates", id))
      .filter((c): c is ManuscriptCandidate => Boolean(c))
      .map(({ markdown: _m, base_markdown: _b, ...meta }) => meta)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json({ candidates: list });
  });

  app.get("/api/narrative/candidates/:id", (req, res) => {
    const c = narrativeStore.loadJson<ManuscriptCandidate>("candidates", req.params.id);
    if (!c) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    res.json({ candidate: c });
  });

  /** Saves a client-built candidate (e.g. an Openings Lab gateway) so it is persisted with history. */
  app.post("/api/narrative/candidates", (req, res) => {
    const c = req.body?.candidate as ManuscriptCandidate | undefined;
    if (!c || typeof c.candidate_id !== "string" || typeof c.markdown !== "string" || typeof c.base_markdown !== "string") {
      res.status(400).json({ error: "Invalid candidate." });
      return;
    }
    narrativeStore.saveJson("candidates", c.candidate_id, { ...c, status: "staged" });
    narrativeStore.appendHistory({ event: "candidate_staged", candidate: c.candidate_id, origin: c.origin, base: c.base_version_id });
    res.json({ ok: true });
  });

  /** Accept or reject a candidate. Acceptance is refused if the master changed since the candidate was built. */
  app.post("/api/narrative/candidates/:id/decision", (req, res) => {
    const { decision, current_manuscript } = req.body || {};
    const c = narrativeStore.loadJson<ManuscriptCandidate>("candidates", req.params.id);
    if (!c) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (decision === "accept") {
      const check = checkCandidateAcceptable(c, typeof current_manuscript === "string" ? current_manuscript : "");
      if (!check.ok) {
        res.status(409).json({ error: check.reason });
        return;
      }
      narrativeStore.saveJson("candidates", c.candidate_id, { ...c, status: "accepted" });
      narrativeStore.appendHistory({ event: "candidate_accepted", candidate: c.candidate_id, base: c.base_version_id, result: c.version_id });
      res.json({ ok: true, markdown: c.markdown, base_markdown: c.base_markdown, version_id: c.version_id });
      return;
    }
    narrativeStore.saveJson("candidates", c.candidate_id, { ...c, status: "rejected" });
    narrativeStore.appendHistory({ event: "candidate_rejected", candidate: c.candidate_id });
    res.json({ ok: true });
  });

  app.get("/api/narrative/history", (_req, res) => {
    res.json({ history: narrativeStore.readHistory(200) });
  });

  // Ensure unmatched /api/* routes always return valid JSON and never fall through to Vite SPA HTML
  app.use("/api", (_req, res) => {
    res.status(404).json({
      error: "API endpoint not found.",
    });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== "production") {
    const vitePromise = createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

if (
  process.env.NODE_ENV !== "test" &&
  !process.argv.some((arg) => arg.includes("--test"))
) {
  startServer();
}
