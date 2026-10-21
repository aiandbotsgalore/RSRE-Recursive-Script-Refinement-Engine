/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  Sparkles,
  Square,
  ShieldCheck,
  ShieldAlert,
  Lock,
  RotateCcw,
  BookOpen,
  FileCode,
  FileDiff,
  ClipboardList,
  AlertOctagon,
  CheckCircle2,
  Loader2,
  Upload,
  Trash2,
  RefreshCw,
  Clock,
  FileEdit,
  Play,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  FileSearch,
  BookmarkPlus,
  History,
  GitBranch,
  HeartHandshake,
  Volume2,
  Network,
} from "lucide-react";
import {
  parseManuscript,
  resolveSectionById,
  scanPrivacyFence,
  scanQuoteEchoes,
  analyzeSectionCliffhangers,
  analyzeCrossChapterResonance,
  analyzeHumanComplexity,
  analyzeTapeFreshness,
  extractReceiptBoard,
  rollbackSingleSection,
  applySurgicalPatches,
  applyNarratorPatches,
  buildDeterministicNarratorPatches,
  generateDeterministicShowrunnerVariants,
  verifyCueIntegrity,
  computeUpdatedLockedActs,
  type AuditorReport,
  type EditorPatchResponse,
  type NarratorBlockPatch,
} from "./utils/scriptEngine";
import {
  INITIAL_MANUSCRIPT,
  getSimulatedAuditReport,
} from "./utils/sampleManuscript";
import {
  safeFetchJson,
  sanitizeApiErrorMessage,
} from "./utils/safeFetch";
import { ScorecardTab, type PassRecord } from "./components/ScorecardTab";
import {
  SurgicalDiffTab,
  type PassDiffGroup,
} from "./components/SurgicalDiffTab";
import { MasterScriptTab } from "./components/MasterScriptTab";
import { CharterModal } from "./components/CharterModal";
import { ScriptCopilotChat } from "./components/ScriptCopilotChat";
import { ReceiptBoardTab } from "./components/ReceiptBoardTab";
import { ResonanceTab } from "./components/ResonanceTab";
import { ComplexityTab } from "./components/ComplexityTab";
import { TapeDoctorTab } from "./components/TapeDoctorTab";
import { NarrativeIntelligenceTab } from "./components/NarrativeIntelligenceTab";
import { manuscriptVersionId } from "./utils/narrative/hash";

type WorkspaceTab =
  | "input"
  | "master"
  | "diff"
  | "scorecard"
  | "receipts"
  | "resonance"
  | "complexity"
  | "tapedoctor"
  | "narrative"
  | "copilot";

interface ScriptCheckpoint {
  id: string;
  label: string;
  timestamp: string;
  markdown: string;
  score: number | null;
}

const CHECKPOINTS_STORAGE_KEY = "rsre_paper_trail_checkpoints_v1";

type RunState = "idle" | "running" | "completed" | "stopped" | "error";

interface LiveLogEntry {
  id: string;
  time: string;
  text: string;
  tone: "info" | "success" | "warning" | "error";
}

interface PassStepStatus {
  passNumber: number;
  phase: "waiting" | "auditing" | "editing" | "done" | "error";
  detail: string;
  score?: number;
  sectionsEdited?: string[];
  deltaChars?: number;
}

function nowTimeLabel(): string {
  const d = new Date();
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatFriendlyError(err: unknown): string {
  return sanitizeApiErrorMessage(
    err,
    "Our AI writing assistant is momentarily busy. Your script is safe—click Retry to continue."
  );
}

export default function App() {
  // Script State
  const [baselineScript, setBaselineScript] =
    useState<string>(INITIAL_MANUSCRIPT);
  const [workingScript, setWorkingScript] =
    useState<string>(INITIAL_MANUSCRIPT);

  // Refinement Settings State
  const [targetScore, setTargetScore] = useState<number>(90);
  const [maxPasses, setMaxPasses] = useState<number>(3);
  const [pinnedBlockIds, setPinnedBlockIds] = useState<Set<string>>(new Set());

  // Results & History State
  const [passes, setPasses] = useState<PassRecord[]>([]);
  const [passDiffGroups, setPassDiffGroups] = useState<PassDiffGroup[]>([]);
  const [selectedPassIndex, setSelectedPassIndex] = useState<number>(0);
  const [, setLockedActs] = useState<string[]>([]);

  // Active Workspace View ("input" | "master" | "diff" | "scorecard" | "receipts" | "copilot")
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("input");
  const [inputEditorMode, setInputEditorMode] = useState<
    "markdown" | "interactive"
  >("markdown");
  const [isCopilotSidebarOpen, setIsCopilotSidebarOpen] =
    useState<boolean>(true);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [isCharterOpen, setIsCharterOpen] = useState<boolean>(false);
  const [busySectionId, setBusySectionId] = useState<string | null>(null);
  const [externalCopilotPrompt, setExternalCopilotPrompt] = useState<{
    id: string;
    prompt: string;
  } | null>(null);

  // Version Snapshots & Branching ("Save Draft Checkpoint")
  const [checkpoints, setCheckpoints] = useState<ScriptCheckpoint[]>(() => {
    try {
      const raw = window.localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ScriptCheckpoint[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [
      {
        id: "ckpt-initial",
        label: "Original Sample Draft",
        timestamp: nowTimeLabel(),
        markdown: INITIAL_MANUSCRIPT,
        score: null,
      },
    ];
  });
  const [checkpointLabelInput, setCheckpointLabelInput] = useState<string>("");
  const [selectedCheckpointId, setSelectedCheckpointId] =
    useState<string>("ckpt-initial");
  const [rollbackSectionTarget, setRollbackSectionTarget] =
    useState<string>("A101");

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHECKPOINTS_STORAGE_KEY,
        JSON.stringify(checkpoints.slice(-12))
      );
    } catch {
      // ignore storage quota errors
    }
  }, [checkpoints]);

  // Always-Visible Live Status State
  const [runState, setRunState] = useState<RunState>("idle");
  const [currentStepLabel, setCurrentStepLabel] = useState<string>(
    "Ready to audit and polish your script."
  );
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [passSteps, setPassSteps] = useState<PassStepStatus[]>([
    { passNumber: 1, phase: "waiting", detail: "Waiting to start" },
    { passNumber: 2, phase: "waiting", detail: "Waiting to start" },
    { passNumber: 3, phase: "waiting", detail: "Waiting to start" },
  ]);
  const [liveLogs, setLiveLogs] = useState<LiveLogEntry[]>([
    {
      id: "init",
      time: nowTimeLabel(),
      text: "Loaded sample draft script. Click 'Audit & Polish Script' to start refinement. It stops early when no change is required.",
      tone: "info",
    },
  ]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isRunning = runState === "running";

  // Live ticking elapsed timer while running so the user always sees the app is active
  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const appendLog = (
    text: string,
    tone: LiveLogEntry["tone"] = "info"
  ): void => {
    setLiveLogs((prev) => [
      ...prev.slice(-14),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: nowTimeLabel(),
        text,
        tone,
      },
    ]);
  };

  // Real-time deterministic guardrails & Showrunner Intelligence
  const parsedScript = useMemo(
    () => parseManuscript(workingScript),
    [workingScript]
  );
  const livePrivacyScan = useMemo(
    () => scanPrivacyFence(workingScript),
    [workingScript]
  );
  const liveCueIntegrity = useMemo(
    () => verifyCueIntegrity(baselineScript, workingScript),
    [baselineScript, workingScript]
  );
  const liveQuoteEchoReport = useMemo(
    () => scanQuoteEchoes(workingScript),
    [workingScript]
  );
  const liveCliffhangerReport = useMemo(
    () => analyzeSectionCliffhangers(workingScript),
    [workingScript]
  );
  const liveReceiptBoard = useMemo(
    () => extractReceiptBoard(workingScript),
    [workingScript]
  );
  const liveResonanceReport = useMemo(
    () => analyzeCrossChapterResonance(workingScript),
    [workingScript]
  );
  const liveComplexityReport = useMemo(
    () => analyzeHumanComplexity(workingScript),
    [workingScript]
  );
  const liveTapeFreshnessReport = useMemo(
    () => analyzeTapeFreshness(workingScript),
    [workingScript]
  );

  const handleTogglePinBlockId = (blockId: string) => {
    setPinnedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  const handleTogglePinSection = (sectionId: string, blockIds: string[]) => {
    setPinnedBlockIds((prev) => {
      const next = new Set(prev);
      const allPinned =
        blockIds.length > 0 && blockIds.every((id) => next.has(id));
      if (allPinned) {
        blockIds.forEach((id) => next.delete(id));
        appendLog(`Unlocked section [${sectionId}] for editing.`, "info");
      } else {
        blockIds.forEach((id) => next.add(id));
        appendLog(
          `Locked entire section [${sectionId}] (${blockIds.length} narrator blocks protected).`,
          "success"
        );
      }
      return next;
    });
  };

  const handleManualScriptChange = (newMarkdown: string) => {
    setWorkingScript(newMarkdown);
    setBaselineScript(newMarkdown);
    setRunState("idle");
    setCurrentStepLabel("Draft updated. Ready to audit and polish.");
  };

  const resetProgressForCount = (count: number) => {
    setPassSteps(
      Array.from({ length: count }, (_, idx) => ({
        passNumber: idx + 1,
        phase: "waiting",
        detail: "Waiting to start",
      }))
    );
  };

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      if (content.trim()) {
        setBaselineScript(content);
        setWorkingScript(content);
        setPasses([]);
        setPassDiffGroups([]);
        setSelectedPassIndex(0);
        setLockedActs([]);
        setFocusedSectionId(null);
        setRunState("idle");
        setElapsedSeconds(0);
        resetProgressForCount(Math.max(3, maxPasses));
        setActiveTab("input");
        setCurrentStepLabel(
          `Loaded "${file.name}". Ready to audit and polish.`
        );
        appendLog(
          `Uploaded "${file.name}" (${content.length.toLocaleString()} chars). Ready to run.`,
          "info"
        );
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleLoadSampleScript = () => {
    if (isRunning) return;
    setBaselineScript(INITIAL_MANUSCRIPT);
    setWorkingScript(INITIAL_MANUSCRIPT);
    setPasses([]);
    setPassDiffGroups([]);
    setSelectedPassIndex(0);
    setLockedActs([]);
    setFocusedSectionId(null);
    setRunState("idle");
    setElapsedSeconds(0);
    resetProgressForCount(Math.max(3, maxPasses));
    setActiveTab("input");
    setCurrentStepLabel("Reset to sample draft script. Ready to polish.");
    appendLog("Reset script to the original sample draft.", "info");
  };

  const handleClearScript = () => {
    if (isRunning) return;
    setBaselineScript("");
    setWorkingScript("");
    setPasses([]);
    setPassDiffGroups([]);
    setSelectedPassIndex(0);
    setLockedActs([]);
    setFocusedSectionId(null);
    setRunState("idle");
    setElapsedSeconds(0);
    resetProgressForCount(Math.max(3, maxPasses));
    setActiveTab("input");
    setCurrentStepLabel("Script cleared. Paste or upload a script below.");
    appendLog("Cleared script editor.", "info");
  };

  const handleStopLoop = () => {
    stopRequestedRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setRunState("stopped");
    setCurrentStepLabel(
      "Stopped by user. Your latest polished script is preserved below."
    );
    appendLog(
      "Refinement stopped by user. Keeping all completed pass edits.",
      "warning"
    );
  };

  const handleAuditAndPolish = async () => {
    if (isRunning) return;
    if (!workingScript.trim()) {
      setRunState("error");
      setCurrentStepLabel(
        "Please paste or upload a script in '1. Input Script' before polishing."
      );
      appendLog("Cannot start: script editor is empty.", "error");
      setActiveTab("input");
      return;
    }

    // Previously 3 passes were mandatory, forcing edits even when the draft was already effective.
    const MIN_PASSES = 1;
    // A pass whose audit drops more than this below the best scored draft is treated as a regression.
    const REGRESSION_TOLERANCE = 2;
    const cleanTarget = Number.isFinite(targetScore)
      ? Math.min(100, Math.max(50, targetScore))
      : 90;
    const cleanMaxPasses = Number.isFinite(maxPasses)
      ? Math.min(10, Math.max(MIN_PASSES, maxPasses))
      : MIN_PASSES;
    if (maxPasses < MIN_PASSES) {
      setMaxPasses(MIN_PASSES);
    }

    setRunState("running");
    setElapsedSeconds(0);
    stopRequestedRef.current = false;

    let currentDraft = workingScript;
    const originDraft = passes.length === 0 ? workingScript : baselineScript;
    if (passes.length === 0) {
      setBaselineScript(originDraft);
    }

    let currentLockedActs: string[] = [];
    const polishedSectionIds = new Set<string>();
    const accumulatedPasses: PassRecord[] = [];
    const accumulatedDiffs: PassDiffGroup[] = [];

    setPasses([]);
    setPassDiffGroups([]);
    setLockedActs([]);

    const initialSteps: PassStepStatus[] = Array.from(
      { length: cleanMaxPasses },
      (_, idx) => ({
        passNumber: idx + 1,
        phase: "waiting",
        detail: "Queued",
      })
    );
    setPassSteps(initialSteps);

    const initialParsed = parseManuscript(currentDraft);
    const editableSecCount = initialParsed.sections.filter(
      (s) =>
        s.section_id !== "APPENDIX" &&
        s.blocks.some((b) => b.type === "narrator")
    ).length;

    appendLog(
      `Started ${cleanMaxPasses}-pass refinement across ${editableSecCount} script sections (Target Score: ${cleanTarget}/100).`,
      "info"
    );

    let passNum = 1;
    // Strongest scored draft so far (the latest revision is not assumed to be the best).
    let bestScored: { draft: string; score: number; passNumber: number } | null = null;

    const updatePassStep = (
      pNum: number,
      patch: Partial<PassStepStatus>
    ): void => {
      setPassSteps((prev) =>
        prev.map((item) =>
          item.passNumber === pNum ? { ...item, ...patch } : item
        )
      );
    };

    try {
      while (passNum <= cleanMaxPasses && !stopRequestedRef.current) {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const auditMsg = `Pass ${passNum} of ${cleanMaxPasses} — Step 1/2: Auditing script pacing & transitions...`;
        setCurrentStepLabel(auditMsg);
        updatePassStep(passNum, {
          phase: "auditing",
          detail: "Step 1/2: Auditing pacing & transitions...",
        });
        appendLog(
          `Pass ${passNum}/${cleanMaxPasses}: Auditing manuscript against Serial/Pretend rubric...`,
          "info"
        );

        const preFlightPrivacy = scanPrivacyFence(currentDraft);
        const parsedCurrent = parseManuscript(currentDraft);

        const auditPayload = await safeFetchJson<{
          report: AuditorReport;
          privacyScan: ReturnType<typeof scanPrivacyFence>;
          mode: string;
        }>(
          "/api/audit",
          {
            method: "POST",
            body: JSON.stringify({
              manuscript: currentDraft,
              passNumber: passNum,
              targetScore: cleanTarget,
              lockedActs: currentLockedActs,
              previouslyPolishedSectionIds: Array.from(polishedSectionIds),
            }),
            signal: controller.signal,
          },
          // No client-side fallback: an unreachable auditor stops the run instead of inventing
          // directives. The strongest draft so far is preserved.
          { retries: 1 }
        );

        if (stopRequestedRef.current) break;

        const auditorReport = auditPayload.report;
        const currentIntegrity = verifyCueIntegrity(originDraft, currentDraft);

        // Regression guard: if the previous pass made the draft score worse, restore the best draft and stop.
        if (
          bestScored &&
          currentIntegrity.tag_integrity &&
          auditorReport.composite_score < bestScored.score - REGRESSION_TOLERANCE
        ) {
          currentDraft = bestScored.draft;
          setWorkingScript(currentDraft);
          updatePassStep(passNum, {
            phase: "done",
            score: auditorReport.composite_score,
            detail: `Regression: restored Pass ${bestScored.passNumber} draft`,
          });
          appendLog(
            `Pass ${passNum}/${cleanMaxPasses}: score fell to ${auditorReport.composite_score.toFixed(1)} from ${bestScored.score.toFixed(1)}. Restored the stronger draft scored on Pass ${bestScored.passNumber} and stopped.`,
            "warning"
          );
          setRunState("completed");
          setCurrentStepLabel(`Stopped on regression. Kept the strongest draft (${bestScored.score.toFixed(1)}/100).`);
          break;
        }
        if (currentIntegrity.tag_integrity && (!bestScored || auditorReport.composite_score >= bestScored.score)) {
          bestScored = { draft: currentDraft, score: auditorReport.composite_score, passNumber: passNum };
        }

        const loopPassed =
          auditorReport.composite_score >= cleanTarget &&
          auditorReport.min_category_score >= 18 &&
          preFlightPrivacy.privacy_gate_passed &&
          auditorReport.privacy_and_tag_audit.privacy_gate_passed &&
          currentIntegrity.tag_integrity;

        const validDirectives = (auditorReport.surgical_directives || [])
          .map((d) => {
            const targetSec = resolveSectionById(parsedCurrent, d.section_id);
            if (!targetSec || targetSec.section_id === "APPENDIX") return null;
            return {
              section_id: targetSec.section_id,
              flaw: d.flaw,
              editorial_order: d.editorial_order,
            };
          })
          .filter((d): d is NonNullable<typeof d> => Boolean(d));

        const targetedSections = validDirectives
          .map((d) => resolveSectionById(parsedCurrent, d.section_id))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({
            section_id: s.section_id,
            rawMarkdown: s.rawMarkdown,
          }));

        // NO CHANGE REQUIRED is a valid outcome: with no justified directives, nothing is rewritten.
        if (validDirectives.length === 0) {
          updatePassStep(passNum, {
            phase: "done",
            score: auditorReport.composite_score,
            sectionsEdited: [],
            deltaChars: 0,
            detail: "No change required",
          });
          appendLog(
            `Pass ${passNum}/${cleanMaxPasses}: auditor found no justified narrator edits (Score ${auditorReport.composite_score.toFixed(1)}/100). NO CHANGE REQUIRED.`,
            "success"
          );
          accumulatedPasses.push({
            passNumber: passNum,
            auditorReport,
            privacyScan: preFlightPrivacy,
            cueIntegrity: currentIntegrity,
            lockedActsAfterPass: currentLockedActs,
            editorChangelog: ["NO CHANGE REQUIRED"],
            guardrailEvents: [],
            scriptSnapshotAfterPass: currentDraft,
            sectionDiffsCount: 0,
            mode: auditPayload.mode,
          });
          setPasses([...accumulatedPasses]);
          setSelectedPassIndex(accumulatedPasses.length - 1);
          setRunState("completed");
          setCurrentStepLabel(`No change required. Score ${auditorReport.composite_score.toFixed(1)}/100.`);
          break;
        }

        const targetSecNames =
          targetedSections.map((s) => s.section_id).join(", ") || "sections";

        const editMsg = `Pass ${passNum} of ${cleanMaxPasses} — Step 2/2: Rewriting [Male Narrator] paragraphs in [${targetSecNames}]...`;
        setCurrentStepLabel(editMsg);
        updatePassStep(passNum, {
          phase: "editing",
          score: auditorReport.composite_score,
          detail: `Step 2/2: Rewriting [${targetSecNames}]...`,
        });
        appendLog(
          `Pass ${passNum}/${cleanMaxPasses}: Audit score ${auditorReport.composite_score.toFixed(
            1
          )}/100. Rewriting [Male Narrator] blocks in [${targetSecNames}]...`,
          "info"
        );

        const editPayload = await safeFetchJson<{
          patchResponse: EditorPatchResponse;
          mode: string;
        }>(
          "/api/edit",
          {
            method: "POST",
            body: JSON.stringify({
              manuscript: currentDraft,
              targetedSections,
              surgicalDirectives: validDirectives,
              lockedActs: [],
              pinnedBlockIds: Array.from(pinnedBlockIds),
            }),
            signal: controller.signal,
          },
          // No rule-based client fallback: an unreachable writer means no edit this pass.
          { retries: 1 }
        );

        if (stopRequestedRef.current) break;

        const narratorPatches = editPayload.patchResponse?.narrator_patches;
        const spliceResult =
          Array.isArray(narratorPatches) && narratorPatches.length > 0
            ? applyNarratorPatches(
                currentDraft,
                narratorPatches,
                [],
                pinnedBlockIds
              )
            : applySurgicalPatches(
                currentDraft,
                editPayload.patchResponse?.patched_sections || [],
                []
              );

        const cumulativeIntegrity = verifyCueIntegrity(
          originDraft,
          spliceResult.assembledMarkdown
        );

        currentDraft = spliceResult.assembledMarkdown;
        setWorkingScript(currentDraft);

        currentLockedActs = computeUpdatedLockedActs(
          currentLockedActs,
          parsedCurrent,
          auditorReport,
          preFlightPrivacy
        );
        setLockedActs(currentLockedActs);

        const passRecord: PassRecord = {
          passNumber: passNum,
          auditorReport,
          privacyScan: preFlightPrivacy,
          cueIntegrity: cumulativeIntegrity,
          lockedActsAfterPass: currentLockedActs,
          editorChangelog: editPayload.patchResponse?.editor_changelog || [],
          guardrailEvents: spliceResult.guardrailEvents,
          scriptSnapshotAfterPass: currentDraft,
          sectionDiffsCount: spliceResult.sectionDiffs.length,
          mode: auditPayload.mode,
        };

        accumulatedPasses.push(passRecord);
        setPasses([...accumulatedPasses]);
        setSelectedPassIndex(accumulatedPasses.length - 1);

        const editedSecIds = spliceResult.sectionDiffs.map((d) => d.section_id);
        const passDeltaChars = spliceResult.sectionDiffs.reduce(
          (acc, d) => acc + d.deltaChars,
          0
        );

        if (spliceResult.sectionDiffs.length > 0) {
          for (const d of spliceResult.sectionDiffs) {
            polishedSectionIds.add(d.section_id.toUpperCase());
          }
          accumulatedDiffs.push({
            passNumber: passNum,
            sectionDiffs: spliceResult.sectionDiffs,
          });
          setPassDiffGroups([...accumulatedDiffs]);
        }

        updatePassStep(passNum, {
          phase: "done",
          score: auditorReport.composite_score,
          sectionsEdited: editedSecIds,
          deltaChars: passDeltaChars,
          detail:
            editedSecIds.length > 0
              ? `Polished ${editedSecIds.join(", ")}`
              : "No changes needed",
        });

        appendLog(
          `Pass ${passNum}/${cleanMaxPasses} finished: Polished [${
            editedSecIds.join(", ") || "none"
          }] (Score: ${auditorReport.composite_score.toFixed(1)}/100).`,
          "success"
        );

        // Automatically switch view to the Final Edited Script tab as soon as Pass 1 finishes
        setActiveTab("master");

        const hasMetMinimumPasses = passNum >= MIN_PASSES;

        if (!spliceResult.anySectionChanged) {
          appendLog(
            `Pass ${passNum}/${cleanMaxPasses}: the writer judged the flagged narration already effective. NO CHANGE REQUIRED.`,
            "success"
          );
        }

        if (
          hasMetMinimumPasses &&
          (loopPassed ||
            passNum === cleanMaxPasses ||
            !spliceResult.anySectionChanged)
        ) {
          const totalPolishedSections = accumulatedDiffs.reduce(
            (sum, g) => sum + g.sectionDiffs.length,
            0
          );
          setRunState("completed");
          setCurrentStepLabel(
            `Finished all ${passNum} passes! Final Score: ${auditorReport.composite_score.toFixed(
              1
            )}/100 · ${totalPolishedSections} section rewrites applied.`
          );
          appendLog(
            `All ${passNum} passes complete! Final Score: ${auditorReport.composite_score.toFixed(
              1
            )}/100 · ${totalPolishedSections} section edit(s) applied. Viewing Final Edited Script below.`,
            "success"
          );
          break;
        }

        passNum++;
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const friendly = formatFriendlyError(err);
        setRunState("error");
        setCurrentStepLabel(friendly);
        updatePassStep(passNum, {
          phase: "error",
          detail: "Interrupted — click Retry",
        });
        appendLog(`Error on Pass ${passNum}: ${friendly}`, "error");
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const initialScore =
    passes.length > 0 ? passes[0].auditorReport.composite_score : null;
  const latestScore =
    passes.length > 0
      ? passes[passes.length - 1].auditorReport.composite_score
      : null;

  const totalChangesCount = passDiffGroups.reduce(
    (acc, g) => acc + g.sectionDiffs.length,
    0
  );

  const allModifiedSectionIds = useMemo(
    () =>
      Array.from(
        new Set(
          passDiffGroups.flatMap((g) =>
            g.sectionDiffs.map((d) => d.section_id)
          )
        )
      ),
    [passDiffGroups]
  );

  const completedPassesCount = passSteps.filter(
    (s) => s.phase === "done"
  ).length;
  const activePassStep = passSteps.find(
    (s) => s.phase === "auditing" || s.phase === "editing"
  );
  const progressPercent = isRunning
    ? Math.min(
        95,
        Math.round(
          ((completedPassesCount +
            (activePassStep?.phase === "editing" ? 0.55 : 0.25)) /
            Math.max(1, passSteps.length)) *
            100
        )
      )
    : runState === "completed"
    ? 100
    : Math.round((completedPassesCount / Math.max(1, passSteps.length)) * 100);

  const narratorBlocksCount = useMemo(
    () =>
      parsedScript.sections.reduce(
        (acc, sec) =>
          acc + sec.blocks.filter((b) => b.type === "narrator").length,
        0
      ),
    [parsedScript]
  );

  const appStateSummary = useMemo(
    () => ({
      runState,
      currentStepLabel,
      targetScore,
      maxPasses,
      activeTab,
      pinnedBlockIds: Array.from(pinnedBlockIds),
      quoteEchoesDetected: liveQuoteEchoReport.totalEchoes,
      quoteEchoDetails: liveQuoteEchoReport.echoes,
      sectionCliffhangers: liveCliffhangerReport.items,
      receiptsCount: liveReceiptBoard.receipts.length,
      contradictionPairs: liveReceiptBoard.contradictionPairs,
      passesCompleted: passes.map((p) => ({
        passNumber: p.passNumber,
        compositeScore: p.auditorReport.composite_score,
        minCategoryScore: p.auditorReport.min_category_score,
        metrics: p.auditorReport.metrics,
        surgicalDirectives: p.auditorReport.surgical_directives,
        editorChangelog: p.editorChangelog,
        sectionDiffsCount: p.sectionDiffsCount,
      })),
      recentDiffs: passDiffGroups.flatMap((g) =>
        g.sectionDiffs.map((d) => ({
          passNumber: g.passNumber,
          sectionId: d.section_id,
          deltaChars: d.deltaChars,
          narratorBlocksBefore: d.narratorBlocksBefore,
          narratorBlocksAfter: d.narratorBlocksAfter,
        }))
      ),
    }),
    [
      runState,
      currentStepLabel,
      targetScore,
      maxPasses,
      activeTab,
      pinnedBlockIds,
      liveQuoteEchoReport,
      liveCliffhangerReport,
      liveReceiptBoard,
      passes,
      passDiffGroups,
    ]
  );

  const handleApplyCopilotSurgicalPatches = (
    patches: NarratorBlockPatch[],
    description: string
  ): number => {
    if (!patches || patches.length === 0) return 0;

    const spliceResult = applyNarratorPatches(
      workingScript,
      patches,
      [],
      pinnedBlockIds
    );

    if (
      !spliceResult.anySectionChanged ||
      spliceResult.sectionDiffs.length === 0
    ) {
      appendLog(
        "Surgical edit skipped (no changes needed or paragraph is pinned).",
        "warning"
      );
      return 0;
    }

    const integrityCheck = verifyCueIntegrity(
      baselineScript,
      spliceResult.assembledMarkdown
    );
    const privacyCheck = scanPrivacyFence(spliceResult.assembledMarkdown);

    if (!integrityCheck.tag_integrity || !privacyCheck.privacy_gate_passed) {
      appendLog(
        "Blocked unsafe edit to protect locked quotes and privacy fence.",
        "error"
      );
      return 0;
    }

    setWorkingScript(spliceResult.assembledMarkdown);
    setPassDiffGroups((prev) => [
      ...prev,
      {
        passNumber: prev.length + 1,
        sectionDiffs: spliceResult.sectionDiffs,
        changelog: [description, ...spliceResult.guardrailEvents],
      },
    ]);
    setCurrentStepLabel(`${description} — viewing updated script.`);
    appendLog(`${description}. Locked quotes verified 1:1.`, "success");
    return spliceResult.sectionDiffs.length;
  };

  // Per-Section Inline Action Handler ("polish" | "cut_25" | "sharpen_lead_in")
  const handleRunSectionAction = async (
    sectionId: string,
    action: "polish" | "cut_25" | "sharpen_lead_in"
  ) => {
    if (busySectionId || isRunning) return;
    const actionLabelMap: Record<
      "polish" | "cut_25" | "sharpen_lead_in",
      string
    > = {
      polish: `Polishing section [${sectionId}]`,
      cut_25: `Cutting narrator word count 25% in [${sectionId}]`,
      sharpen_lead_in: `Cutting Quote-Echoes & sharpening tape setups in [${sectionId}]`,
    };

    setBusySectionId(sectionId);
    setCurrentStepLabel(`${actionLabelMap[action]}...`);
    appendLog(`${actionLabelMap[action]}...`, "info");

    try {
      const data = await safeFetchJson<{
        narrator_patches?: NarratorBlockPatch[];
        action_summary?: string;
      }>(
        "/api/section-action",
        {
          method: "POST",
          body: JSON.stringify({
            manuscript: workingScript,
            sectionId,
            action,
            pinnedBlockIds: Array.from(pinnedBlockIds),
          }),
        },
        {
          retries: 1,
          fallbackOnHtmlOrNetworkError: () => {
            const sec = resolveSectionById(parsedScript, sectionId);
            if (!sec) {
              return { narrator_patches: [], action_summary: "Section not found." };
            }
            const patches: NarratorBlockPatch[] = sec.blocks
              .filter((b) => b.type === "narrator" && !pinnedBlockIds.has(b.id))
              .map((b) => {
                const variants = generateDeterministicShowrunnerVariants(b.rawText);
                const chosen = action === "cut_25" ? variants[1] : variants[0];
                return {
                  section_id: sec.section_id,
                  block_id: b.id,
                  updated_narrator_markdown: chosen.updated_narrator_markdown,
                };
              });
            return {
              narrator_patches: patches,
              action_summary: `${actionLabelMap[action]} complete`,
            };
          },
        }
      );
      const patches = Array.isArray(data.narrator_patches)
        ? data.narrator_patches
        : [];
      if (patches.length > 0) {
        handleApplyCopilotSurgicalPatches(
          patches,
          data.action_summary || `${actionLabelMap[action]} complete`
        );
      } else {
        appendLog(
          data.action_summary || `No editable blocks in [${sectionId}].`,
          "warning"
        );
      }
    } catch (err: unknown) {
      appendLog(formatFriendlyError(err), "error");
    } finally {
      setBusySectionId(null);
    }
  };

  // Version Snapshots & Branching Handlers
  const handleSaveCheckpoint = () => {
    const customLabel =
      checkpointLabelInput.trim() ||
      `Checkpoint #${checkpoints.length} (${
        latestScore !== null ? `Score ${latestScore.toFixed(1)}` : "Draft"
      })`;
    const newCkpt: ScriptCheckpoint = {
      id: `ckpt-${Date.now()}`,
      label: customLabel,
      timestamp: nowTimeLabel(),
      markdown: workingScript,
      score: latestScore,
    };
    setCheckpoints((prev) => [...prev, newCkpt]);
    setSelectedCheckpointId(newCkpt.id);
    setCheckpointLabelInput("");
    setCurrentStepLabel(`Saved checkpoint "${customLabel}".`);
    appendLog(`Saved version checkpoint "${customLabel}".`, "success");
  };

  /**
   * Applies a staged manuscript (Openings Lab gateway or accepted editorial candidate).
   * Refuses if the working script changed since the candidate was built, and saves a
   * checkpoint of the current version first so the change can be rolled back.
   */
  const handleApplyStagedManuscript = (markdown: string, label: string, baseVersionId: string): boolean => {
    if (isRunning) return false;
    if (manuscriptVersionId(workingScript) !== baseVersionId) {
      appendLog(`Refused to apply "${label}": it was built from an older version of the script.`, "error");
      return false;
    }
    const rollback: ScriptCheckpoint = {
      id: `ckpt-${Date.now()}`,
      label: `Before: ${label}`,
      timestamp: nowTimeLabel(),
      markdown: workingScript,
      score: latestScore,
    };
    setCheckpoints((prev) => [...prev, rollback]);
    setSelectedCheckpointId(rollback.id);
    setWorkingScript(markdown);
    setCurrentStepLabel(`Applied "${label}". Restore checkpoint "Before: ${label}" to undo.`);
    appendLog(`Applied staged version "${label}" (rollback checkpoint saved).`, "success");
    return true;
  };

  const handleRestoreFullCheckpoint = () => {
    const ckpt = checkpoints.find((c) => c.id === selectedCheckpointId);
    if (!ckpt) return;
    setWorkingScript(ckpt.markdown);
    setCurrentStepLabel(`Restored full script to checkpoint "${ckpt.label}".`);
    appendLog(`Restored full script to checkpoint "${ckpt.label}".`, "info");
  };

  const handleRollbackSingleSection = () => {
    const ckpt = checkpoints.find((c) => c.id === selectedCheckpointId);
    if (!ckpt || !rollbackSectionTarget) return;
    const { updatedMarkdown, restored } = rollbackSingleSection(
      workingScript,
      ckpt.markdown,
      rollbackSectionTarget
    );
    if (restored) {
      setWorkingScript(updatedMarkdown);
      setCurrentStepLabel(
        `Rolled back section [${rollbackSectionTarget}] to checkpoint "${ckpt.label}" (all other sections preserved).`
      );
      appendLog(
        `Rolled back section [${rollbackSectionTarget}] to "${ckpt.label}" without losing edits in other sections.`,
        "success"
      );
    } else {
      appendLog(
        `Section [${rollbackSectionTarget}] is already identical to checkpoint "${ckpt.label}".`,
        "info"
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#E6EDF3] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="px-6 py-3.5 bg-[#161B22] border-b border-[#30363D] flex items-center justify-between gap-6">
        <span className="text-base font-bold tracking-tight text-[#E6EDF3] whitespace-nowrap shrink-0">
          The Paper Trail
        </span>

        <nav
          aria-label="Workspace Navigation"
          className="hidden md:flex items-center gap-5 text-xs font-medium text-[#8B949E]"
        >
          <button
            type="button"
            onClick={() => setActiveTab("input")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "input"
                ? "text-[#E6EDF3] underline underline-offset-4"
                : ""
            }`}
          >
            Input Script
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("master")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "master"
                ? "text-[#E6EDF3] underline underline-offset-4"
                : ""
            }`}
          >
            Final Edited Script
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("diff")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "diff"
                ? "text-[#E6EDF3] underline underline-offset-4"
                : ""
            }`}
          >
            Changes Made ({totalChangesCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("scorecard")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "scorecard"
                ? "text-[#E6EDF3] underline underline-offset-4"
                : ""
            }`}
          >
            Script Quality Score
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("receipts")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "receipts"
                ? "text-[#E6EDF3] underline underline-offset-4"
                : ""
            }`}
          >
            Receipt Board ({liveReceiptBoard.receipts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("resonance")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === "resonance"
                ? "text-[#58A6FF] underline underline-offset-4 font-bold"
                : ""
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-[#58A6FF]" />
            <span>Cross-Chapter Resonance ({liveResonanceReport.items.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("complexity")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === "complexity"
                ? "text-[#3FB950] underline underline-offset-4 font-bold"
                : ""
            }`}
          >
            <HeartHandshake className="w-3.5 h-3.5 text-[#3FB950]" />
            <span>Character Arcs &amp; Nuance ({liveComplexityReport.overallComplexityScore}%)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("tapedoctor")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === "tapedoctor"
                ? "text-[#D29922] underline underline-offset-4 font-bold"
                : ""
            }`}
          >
            <Volume2 className="w-3.5 h-3.5 text-[#D29922]" />
            <span>Tape Doctor ({liveTapeFreshnessReport.issues.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("narrative")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === "narrative"
                ? "text-[#58A6FF] underline underline-offset-4 font-bold"
                : ""
            }`}
          >
            <Network className="w-3.5 h-3.5 text-[#58A6FF]" />
            <span>Narrative Intelligence</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("copilot")}
            className={`hover:text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "copilot"
                ? "text-[#E6EDF3] underline underline-offset-4"
                : ""
            }`}
          >
            AI Co-Pilot Chat
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsCopilotSidebarOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              isCopilotSidebarOpen
                ? "bg-[#0D1117] border-[#58A6FF] text-[#58A6FF]"
                : "bg-[#0D1117] border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3]"
            }`}
          >
            {isCopilotSidebarOpen ? (
              <PanelRightClose className="w-3.5 h-3.5" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5 text-[#58A6FF]" />
            )}
            <span>AI Co-Pilot</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCharterOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#58A6FF] text-xs font-medium text-[#E6EDF3] transition-colors whitespace-nowrap shrink-0"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#58A6FF]" />
            <span>Editorial Guide</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* ALWAYS-VISIBLE LIVE STATUS & REFINEMENT CONTROL CENTER */}
        <section
          aria-label="Live Refinement Status and Controls"
          data-testid="live-status-console"
          className={`bg-[#161B22] border rounded-md p-5 space-y-4 ${
            runState === "running"
              ? "border-[#58A6FF]"
              : runState === "completed"
              ? "border-[#3FB950]"
              : runState === "error"
              ? "border-[#F85149]"
              : "border-[#30363D]"
          }`}
        >
          {/* Row 1: Live State Headline + Settings + Primary Action CTA */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                {runState === "running" && (
                  <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#58A6FF]">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    WORKING LIVE
                  </span>
                )}
                {runState === "completed" && (
                  <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#3FB950]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    COMPLETED ALL PASSES
                  </span>
                )}
                {runState === "error" && (
                  <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#F85149]">
                    <AlertOctagon className="w-4 h-4 shrink-0" />
                    PAUSED — ACTION NEEDED
                  </span>
                )}
                {runState === "stopped" && (
                  <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#D29922]">
                    <Square className="w-3.5 h-3.5 shrink-0" />
                    STOPPED BY USER
                  </span>
                )}
                {runState === "idle" && (
                  <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#8B949E]">
                    <Play className="w-3.5 h-3.5 text-[#58A6FF] shrink-0" />
                    READY TO POLISH
                  </span>
                )}

                <span className="text-[#484F58]">·</span>

                <span className="flex items-center gap-1 text-xs font-mono text-[#8B949E] tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  Elapsed: {elapsedSeconds}s
                </span>

                <span className="text-[#484F58]">·</span>

                <span
                  data-testid="badge-quotes-locked"
                  className={`flex items-center gap-1 text-xs font-mono tabular-nums ${
                    liveCueIntegrity.tag_integrity
                      ? "text-[#3FB950]"
                      : "text-[#F85149]"
                  }`}
                >
                  <Lock className="w-3 h-3 text-[#58A6FF]" />
                  Quotes:{" "}
                  {liveCueIntegrity.tag_integrity
                    ? `LOCKED (${liveCueIntegrity.blockquotes_after})`
                    : "CHANGED"}
                </span>

                <span className="text-[#484F58]">·</span>

                <span
                  data-testid="badge-privacy-fence"
                  className={`flex items-center gap-1 text-xs font-mono ${
                    livePrivacyScan.privacy_gate_passed
                      ? "text-[#3FB950]"
                      : "text-[#F85149]"
                  }`}
                >
                  {livePrivacyScan.privacy_gate_passed ? (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  )}
                  Privacy: {livePrivacyScan.privacy_gate_passed ? "PASS" : "FAIL"}
                </span>

                <span className="text-[#484F58]">·</span>

                <button
                  type="button"
                  onClick={() => setActiveTab("receipts")}
                  className={`flex items-center gap-1 text-xs font-mono hover:underline ${
                    liveQuoteEchoReport.totalEchoes === 0
                      ? "text-[#3FB950]"
                      : "text-[#D29922]"
                  }`}
                >
                  Quote Echoes: {liveQuoteEchoReport.totalEchoes}
                </button>
              </div>

              <div
                role="status"
                aria-live="polite"
                className={`text-sm font-semibold ${
                  runState === "error"
                    ? "text-[#F85149]"
                    : runState === "completed"
                    ? "text-[#3FB950]"
                    : "text-[#E6EDF3]"
                }`}
              >
                {currentStepLabel}
              </div>
            </div>

            {/* Settings + Primary Button */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <label className="flex items-center gap-2 text-xs text-[#8B949E] bg-[#0D1117] border border-[#30363D] rounded px-3 py-2">
                <span>Target Score:</span>
                <input
                  id="target-score-input"
                  type="number"
                  min={50}
                  max={100}
                  value={targetScore}
                  onChange={(e) => setTargetScore(Number(e.target.value))}
                  disabled={isRunning}
                  className="w-12 bg-transparent text-[#E6EDF3] font-mono text-xs font-semibold tabular-nums focus:outline-none text-right"
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-[#8B949E] bg-[#0D1117] border border-[#30363D] rounded px-3 py-2">
                <span>Passes (Min 3):</span>
                <input
                  id="max-passes-input"
                  type="number"
                  min={3}
                  max={10}
                  value={maxPasses}
                  onChange={(e) => {
                    const nextVal = Math.max(3, Number(e.target.value) || 3);
                    setMaxPasses(nextVal);
                    if (!isRunning) resetProgressForCount(nextVal);
                  }}
                  disabled={isRunning}
                  className="w-10 bg-transparent text-[#E6EDF3] font-mono text-xs font-semibold tabular-nums focus:outline-none text-right"
                />
              </label>

              {runState === "error" && (
                <button
                  type="button"
                  onClick={handleAuditAndPolish}
                  className="flex items-center gap-1.5 px-4 py-2 rounded bg-[#F85149] text-[#0D1117] text-xs font-bold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleAuditAndPolish}
                disabled={isRunning}
                className="flex items-center justify-center gap-2 px-5 py-2 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 disabled:opacity-80 text-[#0D1117] text-xs font-bold transition-colors whitespace-nowrap shrink-0"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      Running Pass {activePassStep?.passNumber ?? 1} of{" "}
                      {passSteps.length}...
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Audit &amp; Polish Script</span>
                  </>
                )}
              </button>

              {isRunning && (
                <button
                  type="button"
                  onClick={handleStopLoop}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded bg-[#0D1117] border border-[#F85149] text-[#F85149] hover:bg-[#F85149]/15 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Live Progress Bar & 3-Pass Stepper */}
          <div className="space-y-2.5">
            <div className="w-full h-1.5 bg-[#0D1117] rounded overflow-hidden border border-[#30363D]">
              <div
                className={`h-full transition-all duration-300 ${
                  runState === "completed"
                    ? "bg-[#3FB950]"
                    : runState === "error"
                    ? "bg-[#F85149]"
                    : "bg-[#58A6FF]"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {passSteps.slice(0, 3).map((step) => {
                const isActive =
                  step.phase === "auditing" || step.phase === "editing";
                const isDone = step.phase === "done";
                const isErr = step.phase === "error";
                return (
                  <div
                    key={step.passNumber}
                    className={`p-3 rounded border font-mono text-xs flex flex-col justify-between gap-1 ${
                      isActive
                        ? "bg-[#0D1117] border-[#58A6FF] text-[#E6EDF3]"
                        : isDone
                        ? "bg-[#0D1117] border-[#3FB950]/60 text-[#E6EDF3]"
                        : isErr
                        ? "bg-[#0D1117] border-[#F85149] text-[#F85149]"
                        : "bg-[#0D1117]/60 border-[#30363D] text-[#8B949E]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold flex items-center gap-1.5">
                        {isActive && (
                          <Loader2 className="w-3.5 h-3.5 text-[#58A6FF] animate-spin shrink-0" />
                        )}
                        {isDone && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950] shrink-0" />
                        )}
                        Pass {step.passNumber}
                      </span>
                      {step.score !== undefined && (
                        <span
                          className={`font-bold tabular-nums ${
                            step.score >= targetScore
                              ? "text-[#3FB950]"
                              : "text-[#58A6FF]"
                          }`}
                        >
                          Score: {step.score.toFixed(1)}/100
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#8B949E] truncate">
                      {step.detail}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Row 3: Live Timestamped Activity Feed */}
          <div className="bg-[#0D1117] border border-[#30363D] rounded p-3 space-y-1 font-mono text-xs max-h-28 overflow-y-auto">
            {liveLogs.slice(-4).map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 leading-relaxed"
              >
                <span className="text-[#8B949E] tabular-nums shrink-0">
                  [{entry.time}]
                </span>
                <span
                  className={
                    entry.tone === "success"
                      ? "text-[#3FB950]"
                      : entry.tone === "error"
                      ? "text-[#F85149]"
                      : entry.tone === "warning"
                      ? "text-[#D29922]"
                      : "text-[#E6EDF3]"
                  }
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>

          {/* Row 4: Version Snapshots & Single-Section Branching Bar */}
          <div
            data-testid="version-checkpoints-bar"
            className="pt-2 border-t border-[#30363D] flex flex-col xl:flex-row xl:items-center justify-between gap-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 font-mono font-bold text-[#E6EDF3]">
                <History className="w-3.5 h-3.5 text-[#58A6FF]" />
                <span>Version Checkpoints:</span>
              </span>
              <input
                type="text"
                value={checkpointLabelInput}
                onChange={(e) => setCheckpointLabelInput(e.target.value)}
                placeholder="Checkpoint name (e.g. 'Tighter Cold Open')..."
                className="px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D] text-xs text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:border-[#58A6FF] w-56"
              />
              <button
                type="button"
                onClick={handleSaveCheckpoint}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#0D1117] border border-[#58A6FF] hover:bg-[#58A6FF]/15 text-[#58A6FF] font-semibold transition-colors whitespace-nowrap"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Save Draft Checkpoint</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono">
              <select
                aria-label="Select Saved Checkpoint"
                value={selectedCheckpointId}
                onChange={(e) => setSelectedCheckpointId(e.target.value)}
                className="px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D] text-xs text-[#E6EDF3] focus:outline-none focus:border-[#58A6FF]"
              >
                {checkpoints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.timestamp})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleRestoreFullCheckpoint}
                className="px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3] transition-colors whitespace-nowrap"
              >
                Restore Full Script
              </button>

              <span className="text-[#484F58]">|</span>

              <select
                aria-label="Select Section to Rollback"
                value={rollbackSectionTarget}
                onChange={(e) => setRollbackSectionTarget(e.target.value)}
                className="px-2 py-1 rounded bg-[#0D1117] border border-[#30363D] text-xs text-[#E6EDF3] focus:outline-none focus:border-[#58A6FF]"
              >
                {parsedScript.sections
                  .filter((s) => s.section_id !== "APPENDIX")
                  .map((s) => (
                    <option key={s.section_id} value={s.section_id}>
                      Section [{s.section_id}]
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={handleRollbackSingleSection}
                className="px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#58A6FF] text-[#58A6FF] transition-colors whitespace-nowrap"
              >
                Rollback Single Section
              </button>
            </div>
          </div>
        </section>

        {/* WORKSPACE VIEW TABS */}
        <section aria-label="Script Workspace" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#30363D] pb-3">
            <div
              role="tablist"
              aria-label="Script Views"
              className="bg-[#161B22] border border-[#30363D] rounded-md p-1 flex flex-wrap items-center gap-1 text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "input"}
                onClick={() => setActiveTab("input")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "input"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <FileEdit className="w-3.5 h-3.5" />
                <span>1. Your Draft Script</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "master"}
                onClick={() => setActiveTab("master")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "master"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>
                  2. Final Polished Script
                  {allModifiedSectionIds.length > 0
                    ? ` (${allModifiedSectionIds.length} Sections Edited)`
                    : ""}
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "diff"}
                onClick={() => setActiveTab("diff")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "diff"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <FileDiff className="w-3.5 h-3.5" />
                <span>3. Changes Made ({totalChangesCount})</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "scorecard"}
                onClick={() => setActiveTab("scorecard")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "scorecard"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>
                  4. Script Quality Score
                  {latestScore !== null ? ` (${latestScore.toFixed(1)})` : ""}
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "receipts"}
                onClick={() => setActiveTab("receipts")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "receipts"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <FileSearch className="w-3.5 h-3.5" />
                <span>
                  5. Receipt Board ({liveReceiptBoard.receipts.length})
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "resonance"}
                onClick={() => setActiveTab("resonance")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "resonance"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>
                  6. Cross-Chapter Resonance ({liveResonanceReport.items.length})
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "complexity"}
                onClick={() => setActiveTab("complexity")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "complexity"
                    ? "bg-[#0D1117] border border-[#3FB950] text-[#3FB950] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <HeartHandshake className="w-3.5 h-3.5" />
                <span>
                  7. Human Complexity &amp; Arcs ({liveComplexityReport.overallComplexityScore}%)
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "tapedoctor"}
                onClick={() => setActiveTab("tapedoctor")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "tapedoctor"
                    ? "bg-[#0D1117] border border-[#D29922] text-[#D29922] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>
                  8. Tape Freshness Doctor ({liveTapeFreshnessReport.issues.length})
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "narrative"}
                onClick={() => setActiveTab("narrative")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "narrative"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span>9. Narrative Intelligence</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "copilot"}
                onClick={() => setActiveTab("copilot")}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === "copilot"
                    ? "bg-[#0D1117] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                    : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>10. AI Co-Pilot &amp; Spot Review</span>
              </button>
            </div>

            <div className="text-xs font-mono text-[#8B949E] tabular-nums">
              {parsedScript.sections.length} Sections ·{" "}
              {liveCueIntegrity.blockquotes_after} Quotes Locked
              {pinnedBlockIds.size > 0
                ? ` · ${pinnedBlockIds.size} Kept Paragraph(s)`
                : ""}
            </div>
          </div>

          {/* WORKSPACE + LIVE AI CO-PILOT SPLIT GRID */}
          <div
            className={`grid grid-cols-1 gap-5 items-start ${
              isCopilotSidebarOpen && activeTab !== "copilot"
                ? "xl:grid-cols-12"
                : ""
            }`}
          >
            <div
              className={
                isCopilotSidebarOpen && activeTab !== "copilot"
                  ? "xl:col-span-7 space-y-4"
                  : "w-full space-y-4"
              }
            >
              {/* TAB 1: INPUT SCRIPT EDITOR (RAW MARKDOWN OR INTERACTIVE SECTION STUDIO) */}
              {activeTab === "input" && (
                <div className="space-y-4">
                  <div className="bg-[#161B22] border border-[#30363D] rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 bg-[#0D1117] border border-[#30363D] rounded p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setInputEditorMode("markdown")}
                        className={`px-3 py-1.5 rounded transition-colors ${
                          inputEditorMode === "markdown"
                            ? "bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                            : "text-[#8B949E] hover:text-[#E6EDF3]"
                        }`}
                      >
                        Raw Markdown Editor
                      </button>
                      <button
                        type="button"
                        onClick={() => setInputEditorMode("interactive")}
                        className={`px-3 py-1.5 rounded transition-colors ${
                          inputEditorMode === "interactive"
                            ? "bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                            : "text-[#8B949E] hover:text-[#E6EDF3]"
                        }`}
                      >
                        Interactive Section Controls &amp; 3 Variants
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".md,.txt,.markdown"
                        onChange={handleUploadFile}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isRunning}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#58A6FF]" />
                        <span>Upload .md / .txt</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleLoadSampleScript}
                        disabled={isRunning}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#58A6FF] text-[#8B949E] hover:text-[#E6EDF3] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset to Sample Draft</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleClearScript}
                        disabled={isRunning || !workingScript}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#F85149] text-[#8B949E] hover:text-[#F85149] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>

                  {inputEditorMode === "markdown" ? (
                    <div className="bg-[#161B22] border border-[#30363D] rounded-md p-5 space-y-3.5">
                      {!livePrivacyScan.privacy_gate_passed && (
                        <div className="p-2.5 rounded bg-[#0D1117] border border-[#F85149] text-xs font-mono text-[#F85149] space-y-1">
                          <div className="font-bold flex items-center gap-1.5">
                            <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
                            <span>Off-limits private phrase detected:</span>
                          </div>
                          {livePrivacyScan.violations.map((v, idx) => (
                            <div key={idx} className="text-[11px]">
                              • Section [{v.section_id}]: &ldquo;{v.phrase}
                              &rdquo;
                            </div>
                          ))}
                        </div>
                      )}

                      <textarea
                        id="manuscript-textarea"
                        aria-label="Your Podcast Script in Markdown"
                        value={workingScript}
                        onChange={(e) =>
                          handleManualScriptChange(e.target.value)
                        }
                        placeholder="Paste your podcast script in Markdown here..."
                        rows={20}
                        spellCheck={false}
                        className="w-full p-4 rounded bg-[#0D1117] border border-[#30363D] text-[#E6EDF3] font-mono text-xs leading-relaxed focus:outline-none focus:border-[#58A6FF] resize-y"
                      />
                    </div>
                  ) : (
                    <MasterScriptTab
                      masterMarkdown={workingScript}
                      baselineMarkdown={baselineScript}
                      cueIntegrity={liveCueIntegrity}
                      latestScore={latestScore}
                      initialScore={initialScore}
                      modifiedSectionIds={allModifiedSectionIds}
                      totalSectionEdits={totalChangesCount}
                      onStartPolish={handleAuditAndPolish}
                      isRunning={isRunning}
                      pinnedBlockIds={pinnedBlockIds}
                      onTogglePinBlockId={handleTogglePinBlockId}
                      onTogglePinSection={handleTogglePinSection}
                      onRunSectionAction={handleRunSectionAction}
                      busySectionId={busySectionId}
                      onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                    />
                  )}
                </div>
              )}

              {/* TAB 2: FINAL POLISHED SCRIPT */}
              {activeTab === "master" && (
                <MasterScriptTab
                  masterMarkdown={workingScript}
                  baselineMarkdown={baselineScript}
                  cueIntegrity={liveCueIntegrity}
                  latestScore={latestScore}
                  initialScore={initialScore}
                  modifiedSectionIds={allModifiedSectionIds}
                  totalSectionEdits={totalChangesCount}
                  onStartPolish={handleAuditAndPolish}
                  isRunning={isRunning}
                  pinnedBlockIds={pinnedBlockIds}
                  onTogglePinBlockId={handleTogglePinBlockId}
                  onTogglePinSection={handleTogglePinSection}
                  onRunSectionAction={handleRunSectionAction}
                  busySectionId={busySectionId}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                />
              )}

              {/* TAB 3: HIGHLIGHTED CHANGES */}
              {activeTab === "diff" && (
                <SurgicalDiffTab
                  passDiffGroups={passDiffGroups}
                  focusedSectionId={focusedSectionId}
                  onSelectSectionFilter={setFocusedSectionId}
                  pinnedBlockIds={pinnedBlockIds}
                  onTogglePinBlockId={handleTogglePinBlockId}
                />
              )}

              {/* TAB 4: SCRIPT QUALITY SCORE */}
              {activeTab === "scorecard" && (
                <ScorecardTab
                  passes={passes}
                  selectedPassIndex={selectedPassIndex}
                  onSelectPass={setSelectedPassIndex}
                  targetScore={targetScore}
                  isRunning={isRunning}
                  currentStepLabel={currentStepLabel}
                  onJumpToDiff={(sectionId) => {
                    setFocusedSectionId(sectionId || null);
                    setActiveTab("diff");
                  }}
                />
              )}

              {/* TAB 5: THE RECEIPT BOARD (EVIDENCE & TIMELINE CROSS-REFERENCE) */}
              {activeTab === "receipts" && (
                <ReceiptBoardTab
                  receiptBoard={liveReceiptBoard}
                  quoteEchoReport={liveQuoteEchoReport}
                  cliffhangerReport={liveCliffhangerReport}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                  onRunSectionAction={handleRunSectionAction}
                  busySectionId={busySectionId}
                  onAskCopilotPrompt={(prompt) => {
                    setIsCopilotSidebarOpen(true);
                    setExternalCopilotPrompt({
                      id: `ext-${Date.now()}`,
                      prompt,
                    });
                  }}
                />
              )}

              {/* TAB 6: CROSS-CHAPTER NARRATIVE RESONANCE & DOUBLE-TAKE WORKBENCH */}
              {activeTab === "resonance" && (
                <ResonanceTab
                  resonanceReport={liveResonanceReport}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                  onAskCopilotPrompt={(prompt) => {
                    setIsCopilotSidebarOpen(true);
                    setExternalCopilotPrompt({
                      id: `ext-${Date.now()}`,
                      prompt,
                    });
                  }}
                  onJumpToSection={(secId) => {
                    setFocusedSectionId(secId);
                    setActiveTab("master");
                  }}
                />
              )}

              {/* TAB 7: RELATIONSHIP & HUMAN COMPLEXITY TRACKER */}
              {activeTab === "complexity" && (
                <ComplexityTab
                  complexityReport={liveComplexityReport}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                  onAskCopilotPrompt={(prompt) => {
                    setIsCopilotSidebarOpen(true);
                    setExternalCopilotPrompt({
                      id: `ext-${Date.now()}`,
                      prompt,
                    });
                  }}
                  onJumpToSection={(secId) => {
                    setFocusedSectionId(secId);
                    setActiveTab("master");
                  }}
                />
              )}

              {/* TAB 9: NARRATIVE INTELLIGENCE ENGINE */}
              {activeTab === "narrative" && (
                <NarrativeIntelligenceTab
                  manuscript={workingScript}
                  pinnedBlockIds={pinnedBlockIds}
                  onApplyStagedManuscript={handleApplyStagedManuscript}
                  onJumpToSection={(secId) => {
                    setFocusedSectionId(secId);
                    setActiveTab("master");
                  }}
                />
              )}

              {/* TAB 8: TAPE HAND-OFF & FRESHNESS DOCTOR */}
              {activeTab === "tapedoctor" && (
                <TapeDoctorTab
                  tapeFreshnessReport={liveTapeFreshnessReport}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                  onAskCopilotPrompt={(prompt) => {
                    setIsCopilotSidebarOpen(true);
                    setExternalCopilotPrompt({
                      id: `ext-${Date.now()}`,
                      prompt,
                    });
                  }}
                  onJumpToSection={(secId) => {
                    setFocusedSectionId(secId);
                    setActiveTab("master");
                  }}
                />
              )}

              {/* TAB 9: FULL-WIDTH AI CO-PILOT & SPOT REVIEW */}
              {activeTab === "copilot" && (
                <ScriptCopilotChat
                  workingScript={workingScript}
                  sectionsCount={parsedScript.sections.length}
                  narratorBlocksCount={narratorBlocksCount}
                  lockedQuotesCount={liveCueIntegrity.blockquotes_after}
                  passesCompletedCount={passes.length}
                  latestScore={latestScore}
                  totalChangesCount={totalChangesCount}
                  appStateSummary={appStateSummary}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                  onJumpToSectionDiff={(sectionId) => {
                    setFocusedSectionId(sectionId);
                    setActiveTab("diff");
                  }}
                  isExpandedView={true}
                  externalPromptRequest={externalCopilotPrompt}
                />
              )}
            </div>

            {/* SIDE-BY-SIDE DOCKED AI CO-PILOT PANEL */}
            {isCopilotSidebarOpen && activeTab !== "copilot" && (
              <aside
                aria-label="AI Showrunner Co-Pilot Sidebar"
                className="xl:col-span-5"
              >
                <ScriptCopilotChat
                  workingScript={workingScript}
                  sectionsCount={parsedScript.sections.length}
                  narratorBlocksCount={narratorBlocksCount}
                  lockedQuotesCount={liveCueIntegrity.blockquotes_after}
                  passesCompletedCount={passes.length}
                  latestScore={latestScore}
                  totalChangesCount={totalChangesCount}
                  appStateSummary={appStateSummary}
                  onApplySurgicalPatches={handleApplyCopilotSurgicalPatches}
                  onJumpToSectionDiff={(sectionId) => {
                    setFocusedSectionId(sectionId);
                    setActiveTab("diff");
                  }}
                  externalPromptRequest={externalCopilotPrompt}
                />
              </aside>
            )}
          </div>
        </section>
      </main>

      <CharterModal
        isOpen={isCharterOpen}
        onClose={() => setIsCharterOpen(false)}
      />
    </div>
  );
}
