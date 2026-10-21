import React, { useState, useMemo } from "react";
import {
  Copy,
  Check,
  Download,
  ShieldCheck,
  FileCode,
  SplitSquareVertical,
  Sparkles,
  Lock,
  Unlock,
  Wand2,
  Scissors,
  Zap,
  Layers,
  Loader2,
  AlertTriangle,
  GitBranch,
  ArrowRight,
  HeartHandshake,
  Volume2,
  CheckCircle2,
  ShieldAlert,
  Network,
} from "lucide-react";
import { PAPER_TRAIL_KNOWLEDGE } from "../utils/narrative/knowledgeBase";
import { buildStoryModel, getSceneNode, getDependenciesForScene } from "../utils/narrative/storyModel";
import { simulateListenerTimeline, getListenerStateForScene } from "../utils/narrative/listenerModel";
import {
  parseManuscript,
  scanQuoteEchoes,
  analyzeSectionCliffhangers,
  analyzeCrossChapterResonance,
  getResonanceLinksForSection,
  analyzeHumanComplexity,
  getComplexityForSection,
  analyzeTapeFreshness,
  getTapeFreshnessForSection,
  generateDeterministicShowrunnerVariants,
  type CueIntegrityReport,
  type NarratorBlockPatch,
  type ShowrunnerVariantItem,
} from "../utils/scriptEngine";
import { safeFetchJson } from "../utils/safeFetch";

interface MasterScriptTabProps {
  masterMarkdown: string;
  baselineMarkdown: string;
  cueIntegrity: CueIntegrityReport;
  latestScore: number | null;
  initialScore: number | null;
  modifiedSectionIds: string[];
  totalSectionEdits: number;
  onStartPolish?: () => void;
  isRunning?: boolean;
  pinnedBlockIds?: Set<string>;
  onTogglePinBlockId?: (blockId: string) => void;
  onTogglePinSection?: (sectionId: string, blockIds: string[]) => void;
  onRunSectionAction?: (
    sectionId: string,
    action: "polish" | "cut_25" | "sharpen_lead_in"
  ) => Promise<void>;
  busySectionId?: string | null;
  onApplySurgicalPatches?: (
    patches: NarratorBlockPatch[],
    description: string
  ) => number;
}

export const MasterScriptTab: React.FC<MasterScriptTabProps> = ({
  masterMarkdown,
  baselineMarkdown,
  cueIntegrity,
  latestScore,
  initialScore,
  modifiedSectionIds,
  totalSectionEdits,
  onStartPolish,
  isRunning = false,
  pinnedBlockIds = new Set<string>(),
  onTogglePinBlockId,
  onTogglePinSection,
  onRunSectionAction,
  busySectionId = null,
  onApplySurgicalPatches,
}) => {
  const [copied, setCopied] = useState(false);
  const [displayMode, setDisplayMode] = useState<
    "clean" | "annotated" | "compare"
  >("annotated");

  // State for 3-Option Showrunner Variants per [Male Narrator] block
  const [variantsByBlockId, setVariantsByBlockId] = useState<
    Record<string, ShowrunnerVariantItem[]>
  >({});
  const [loadingVariantsBlockId, setLoadingVariantsBlockId] = useState<
    string | null
  >(null);
  const [openVariantsBlockId, setOpenVariantsBlockId] = useState<string | null>(
    null
  );

  const hasEdits =
    totalSectionEdits > 0 || masterMarkdown.trim() !== baselineMarkdown.trim();

  const modifiedSet = useMemo(
    () => new Set(modifiedSectionIds.map((id) => id.toUpperCase())),
    [modifiedSectionIds]
  );

  const parsedMaster = useMemo(
    () => parseManuscript(masterMarkdown),
    [masterMarkdown]
  );

  const quoteEchoReport = useMemo(
    () => scanQuoteEchoes(masterMarkdown),
    [masterMarkdown]
  );

  const cliffhangerReport = useMemo(
    () => analyzeSectionCliffhangers(masterMarkdown),
    [masterMarkdown]
  );

  const resonanceReport = useMemo(
    () => analyzeCrossChapterResonance(masterMarkdown),
    [masterMarkdown]
  );

  const complexityReport = useMemo(
    () => analyzeHumanComplexity(masterMarkdown),
    [masterMarkdown]
  );

  const tapeFreshnessReport = useMemo(
    () => analyzeTapeFreshness(masterMarkdown),
    [masterMarkdown]
  );

  const [openResonanceSectionId, setOpenResonanceSectionId] = useState<
    string | null
  >(null);

  const [openComplexitySectionId, setOpenComplexitySectionId] = useState<
    string | null
  >(null);

  const [openTapeDoctorSectionId, setOpenTapeDoctorSectionId] = useState<
    string | null
  >(null);

  // Narrative Intelligence: whole-story role, macro action, dependencies, and first-time listener state per section.
  const storyModel = useMemo(
    () => buildStoryModel(masterMarkdown, PAPER_TRAIL_KNOWLEDGE),
    [masterMarkdown]
  );
  const listenerTimeline = useMemo(
    () => simulateListenerTimeline(masterMarkdown, PAPER_TRAIL_KNOWLEDGE, storyModel),
    [masterMarkdown, storyModel]
  );
  const [openStoryArcSectionId, setOpenStoryArcSectionId] = useState<
    string | null
  >(null);

  const echoByBlockId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of quoteEchoReport.echoes) {
      map.set(e.narrator_block_id, e.editorial_fix_directive);
    }
    return map;
  }, [quoteEchoReport]);

  const cliffhangerBySectionId = useMemo(() => {
    const map = new Map<
      string,
      { status: "strong_turn" | "needs_cliffhanger"; turn_type: string }
    >();
    for (const c of cliffhangerReport.items) {
      map.set(c.section_id.toUpperCase(), {
        status: c.status,
        turn_type: c.turn_type,
      });
    }
    return map;
  }, [cliffhangerReport]);

  const handleFetchVariantsForBlock = async (
    sectionId: string,
    blockId: string,
    narratorText: string
  ) => {
    if (openVariantsBlockId === blockId && variantsByBlockId[blockId]) {
      setOpenVariantsBlockId(null);
      return;
    }
    setOpenVariantsBlockId(blockId);
    setLoadingVariantsBlockId(blockId);
    try {
      const data = await safeFetchJson<{
        variants?: ShowrunnerVariantItem[];
      }>(
        "/api/variants",
        {
          method: "POST",
          body: JSON.stringify({
            manuscript: masterMarkdown,
            sectionId,
            blockId,
            narratorMarkdown: narratorText,
          }),
        },
        {
          retries: 1,
          fallbackOnHtmlOrNetworkError: () => ({
            variants: generateDeterministicShowrunnerVariants(narratorText),
          }),
        }
      );
      if (Array.isArray(data.variants) && data.variants.length > 0) {
        setVariantsByBlockId((prev) => ({
          ...prev,
          [blockId]: data.variants!,
        }));
      }
    } finally {
      setLoadingVariantsBlockId(null);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(masterMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement("textarea");
      el.value = masterMarkdown;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([masterMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "the-paper-trail-polished.md";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Top Export & Status Bar */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
            {hasEdits ? (
              <>
                <ShieldCheck className="w-4 h-4 text-[#3FB950] shrink-0" />
                <span className="text-[#3FB950]">
                  Edited Transcript Ready ({modifiedSectionIds.length} Sections
                  Polished)
                </span>
              </>
            ) : (
              <>
                <FileCode className="w-4 h-4 text-[#8B949E] shrink-0" />
                <span>
                  Interactive Section Studio &amp; Final Script (Click any
                  section action or 3 Showrunner Variants below)
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#8B949E] tabular-nums">
            <span>
              Quotes Locked: {cueIntegrity.blockquotes_after}/
              {cueIntegrity.blockquotes_before}
            </span>
            <span>·</span>
            <span>
              Quote Echoes: {quoteEchoReport.totalEchoes}
            </span>
            <span>·</span>
            <span>
              Strong Section Exits: {cliffhangerReport.strongCount}/
              {cliffhangerReport.items.length}
            </span>
            {latestScore !== null && (
              <>
                <span>·</span>
                <span className="text-[#3FB950] font-semibold">
                  {initialScore !== null && initialScore !== latestScore
                    ? `Score: ${initialScore.toFixed(1)} → ${latestScore.toFixed(1)}/100`
                    : `Score: ${latestScore.toFixed(1)}/100`}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Selector */}
          <div className="flex items-center bg-[#0D1117] border border-[#30363D] rounded p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setDisplayMode("annotated")}
              className={`px-2.5 py-1.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                displayMode === "annotated"
                  ? "bg-[#161B22] text-[#58A6FF] font-semibold"
                  : "text-[#8B949E] hover:text-[#E6EDF3]"
              }`}
            >
              Interactive Sections ({parsedMaster.sections.length})
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("clean")}
              className={`px-2.5 py-1.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                displayMode === "clean"
                  ? "bg-[#161B22] text-[#58A6FF] font-semibold"
                  : "text-[#8B949E] hover:text-[#E6EDF3]"
              }`}
            >
              Clean Markdown
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("compare")}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                displayMode === "compare"
                  ? "bg-[#161B22] text-[#58A6FF] font-semibold"
                  : "text-[#8B949E] hover:text-[#E6EDF3]"
              }`}
            >
              <SplitSquareVertical className="w-3.5 h-3.5" />
              <span>Original vs. Edited</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded bg-[#0D1117] border border-[#58A6FF] hover:bg-[#58A6FF]/15 text-xs font-mono font-semibold text-[#58A6FF] transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-[#3FB950]" />
                <span className="text-[#3FB950]">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Final Script</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-xs font-mono font-bold text-[#0D1117] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Download .md File</span>
          </button>
        </div>
      </div>

      {!hasEdits && onStartPolish && !isRunning && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-md p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-[#8B949E]">
            Use the <strong>Per-Section Action Toolbar</strong> on any section
            below, click <strong>3 Showrunner Variants</strong> on any{" "}
            <code className="font-mono text-[#E6EDF3]">[Male Narrator]</code>{" "}
            paragraph, or run the full 3-pass polish.
          </div>
          <button
            type="button"
            onClick={onStartPolish}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#58A6FF] text-[#0D1117] font-bold hover:bg-[#58A6FF]/90 transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Run Full 3-Pass Polish</span>
          </button>
        </div>
      )}

      {/* VIEW 1: Clean Full Markdown */}
      {displayMode === "clean" && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-md p-5">
          <pre
            data-testid="final-master-markdown"
            className="font-mono text-xs text-[#E6EDF3] whitespace-pre-wrap break-words leading-relaxed select-all"
          >
            {masterMarkdown}
          </pre>
        </div>
      )}

      {/* VIEW 2: Interactive Section-by-Section Studio with Per-Section Action Toolbar & 3 Variants */}
      {displayMode === "annotated" && (
        <div className="space-y-4">
          {parsedMaster.sections.map((sec) => {
            const wasPolished = modifiedSet.has(sec.section_id.toUpperCase());
            const narratorBlockIds = sec.blocks
              .filter((b) => b.type === "narrator")
              .map((b) => b.id);
            const isSectionLocked =
              narratorBlockIds.length > 0 &&
              narratorBlockIds.every((id) => pinnedBlockIds.has(id));
            const isSectionBusy = busySectionId === sec.section_id;
            const cliffInfo = cliffhangerBySectionId.get(
              sec.section_id.toUpperCase()
            );

            const secResonanceLinks = getResonanceLinksForSection(
              resonanceReport,
              sec.section_id
            );
            const isResonanceOpen = openResonanceSectionId === sec.section_id;

            const secComplexityMoments = getComplexityForSection(
              complexityReport,
              sec.section_id
            );
            const isComplexityOpen = openComplexitySectionId === sec.section_id;

            const secTapeIssues = getTapeFreshnessForSection(
              tapeFreshnessReport,
              sec.section_id
            );
            const isTapeDoctorOpen = openTapeDoctorSectionId === sec.section_id;

            const arcNode = getSceneNode(storyModel, sec.section_id);
            const arcDeps = arcNode
              ? getDependenciesForScene(storyModel, arcNode.scene_id).filter((d) => d.kind !== "character_thread")
              : [];
            const arcListener = arcNode ? getListenerStateForScene(listenerTimeline, arcNode.scene_id) : undefined;
            const arcOpenFlags = arcListener ? arcListener.confusion.filter((c) => !c.resolved_within_scene) : [];
            const isStoryArcOpen = openStoryArcSectionId === sec.section_id;
            const arcColor =
              arcNode?.role === "pacing_drag" ? "#D29922" : arcNode?.role === "human_texture" ? "#3FB950" : "#A371F7";

            return (
              <div
                key={sec.section_id}
                data-testid={`section-card-${sec.section_id}`}
                className={`bg-[#161B22] border rounded-md overflow-hidden ${
                  isSectionLocked
                    ? "border-[#58A6FF]"
                    : wasPolished
                    ? "border-[#3FB950]/60"
                    : "border-[#30363D]"
                }`}
              >
                {/* Section Header + Per-Section Action Toolbar */}
                <div className="px-4 py-3 bg-[#0D1117] border-b border-[#30363D] flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#58A6FF] font-bold text-[#58A6FF]">
                      [{sec.section_id}]
                    </span>
                    <span className="text-[#E6EDF3] font-semibold">
                      {sec.title}
                    </span>

                    {wasPolished && (
                      <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#3FB950]/50 text-[11px] text-[#3FB950] font-semibold">
                        ✓ Polished
                      </span>
                    )}

                    {secResonanceLinks.length > 0 &&
                      sec.section_id !== "APPENDIX" && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenResonanceSectionId(
                              isResonanceOpen ? null : sec.section_id
                            )
                          }
                          className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono transition-colors ${
                            isResonanceOpen
                              ? "bg-[#58A6FF]/25 border-[#58A6FF] text-[#58A6FF] font-bold"
                              : "bg-[#161B22] border-[#58A6FF]/50 text-[#58A6FF] hover:bg-[#58A6FF]/10"
                          }`}
                          title="View cross-chapter narrative resonance links & double-take callbacks for this section"
                        >
                          <GitBranch className="w-3 h-3 text-[#58A6FF]" />
                          <span>Resonance ({secResonanceLinks.length})</span>
                        </button>
                      )}

                    {secComplexityMoments.length > 0 &&
                      sec.section_id !== "APPENDIX" && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenComplexitySectionId(
                              isComplexityOpen ? null : sec.section_id
                            )
                          }
                          className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono transition-colors ${
                            isComplexityOpen
                              ? "bg-[#3FB950]/25 border-[#3FB950] text-[#3FB950] font-bold"
                              : "bg-[#161B22] border-[#3FB950]/50 text-[#3FB950] hover:bg-[#3FB950]/10"
                          }`}
                          title="View character arc moments & human complexity audits for this section"
                        >
                          <HeartHandshake className="w-3 h-3 text-[#3FB950]" />
                          <span>Human Nuance ({secComplexityMoments.length})</span>
                        </button>
                      )}

                    {secTapeIssues.length > 0 &&
                      sec.section_id !== "APPENDIX" && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenTapeDoctorSectionId(
                              isTapeDoctorOpen ? null : sec.section_id
                            )
                          }
                          className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono transition-colors ${
                            isTapeDoctorOpen
                              ? "bg-[#D29922]/25 border-[#D29922] text-[#D29922] font-bold"
                              : "bg-[#161B22] border-[#D29922]/50 text-[#D29922] hover:bg-[#D29922]/10"
                          }`}
                          title="View lead-in freshness & post-tape over-explanation issues for this section"
                        >
                          <Volume2 className="w-3 h-3 text-[#D29922]" />
                          <span>Tape Doctor ({secTapeIssues.length})</span>
                        </button>
                      )}

                    {arcNode && (
                      <button
                        type="button"
                        data-testid={`story-arc-badge-${sec.section_id}`}
                        onClick={() => setOpenStoryArcSectionId(isStoryArcOpen ? null : sec.section_id)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono transition-colors bg-[#161B22] hover:opacity-80"
                        style={{ borderColor: `${arcColor}80`, color: arcColor, fontWeight: isStoryArcOpen ? 700 : 400 }}
                        title="Whole-story role, recommended action, dependencies, and first-time listener state"
                      >
                        <Network className="w-3 h-3" />
                        <span>
                          [Story Arc] {arcNode.role === "crucial_turn" ? "Turn" : arcNode.role === "human_texture" ? "Texture" : "Drag"}
                          {arcNode.macro_action !== "keep" ? ` · ${arcNode.macro_action.toUpperCase()}` : ""}
                          {arcOpenFlags.length > 0 ? ` · ${arcOpenFlags.length} listener flag${arcOpenFlags.length > 1 ? "s" : ""}` : ""}
                        </span>
                      </button>
                    )}

                    {cliffInfo && sec.section_id !== "APPENDIX" && (
                      <span
                        className={`px-2 py-0.5 rounded bg-[#161B22] border text-[10px] ${
                          cliffInfo.status === "strong_turn"
                            ? "border-[#30363D] text-[#8B949E]"
                            : "border-[#D29922]/60 text-[#D29922]"
                        }`}
                      >
                        Exit: {cliffInfo.turn_type}
                      </span>
                    )}
                  </div>

                  {/* Per-Section Action Toolbar */}
                  {sec.section_id !== "APPENDIX" &&
                    narratorBlockIds.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {onRunSectionAction && (
                          <>
                            <button
                              type="button"
                              disabled={isSectionBusy || isSectionLocked}
                              onClick={() =>
                                void onRunSectionAction(
                                  sec.section_id,
                                  "polish"
                                )
                              }
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3] disabled:opacity-40 transition-colors whitespace-nowrap"
                            >
                              {isSectionBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin text-[#58A6FF]" />
                              ) : (
                                <Wand2 className="w-3 h-3 text-[#58A6FF]" />
                              )}
                              <span>Polish Just This Section</span>
                            </button>

                            <button
                              type="button"
                              disabled={isSectionBusy || isSectionLocked}
                              onClick={() =>
                                void onRunSectionAction(
                                  sec.section_id,
                                  "cut_25"
                                )
                              }
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3] disabled:opacity-40 transition-colors whitespace-nowrap"
                            >
                              <Scissors className="w-3 h-3 text-[#58A6FF]" />
                              <span>Cut Word Count 25%</span>
                            </button>

                            <button
                              type="button"
                              disabled={isSectionBusy || isSectionLocked}
                              onClick={() =>
                                void onRunSectionAction(
                                  sec.section_id,
                                  "sharpen_lead_in"
                                )
                              }
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3] disabled:opacity-40 transition-colors whitespace-nowrap"
                            >
                              <Zap className="w-3 h-3 text-[#58A6FF]" />
                              <span>Sharpen Lead-In to Quote</span>
                            </button>
                          </>
                        )}

                        {onTogglePinSection && (
                          <button
                            type="button"
                            onClick={() =>
                              onTogglePinSection(
                                sec.section_id,
                                narratorBlockIds
                              )
                            }
                            className={`flex items-center gap-1 px-2.5 py-1 rounded border font-mono text-[11px] transition-colors whitespace-nowrap ${
                              isSectionLocked
                                ? "bg-[#58A6FF] border-[#58A6FF] text-[#0D1117] font-bold"
                                : "bg-[#161B22] border-[#30363D] hover:border-[#58A6FF] text-[#8B949E] hover:text-[#E6EDF3]"
                            }`}
                          >
                            {isSectionLocked ? (
                              <>
                                <Lock className="w-3 h-3" />
                                <span>Section Locked</span>
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3 h-3" />
                                <span>Lock Section</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                </div>

                {/* Inline Cross-Chapter Resonance Drawer */}
                {isResonanceOpen && secResonanceLinks.length > 0 && (
                  <div className="bg-[#0D1117] border-b border-[#30363D] p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#58A6FF]">
                        <GitBranch className="w-4 h-4 text-[#58A6FF]" />
                        <span>
                          CROSS-CHAPTER NARRATIVE RESONANCE ({secResonanceLinks.length} Active Link{secResonanceLinks.length > 1 ? "s" : ""})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenResonanceSectionId(null)}
                        className="text-xs text-[#8B949E] hover:text-[#E6EDF3] font-mono"
                      >
                        ✕ Close
                      </button>
                    </div>

                    <div className="space-y-3">
                      {secResonanceLinks.map((link) => (
                        <div
                          key={link.id}
                          className="p-3.5 rounded bg-[#161B22] border border-[#30363D] space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono text-xs">
                              <span className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#58A6FF]/40 text-[#58A6FF] font-bold">
                                {link.early_moment.section_id} &rarr; {link.later_moment.section_id}
                              </span>
                              <span className="font-bold text-[#E6EDF3]">{link.title}</span>
                            </div>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                link.status === "resonated"
                                  ? "bg-[#3FB950]/15 text-[#3FB950] border-[#3FB950]/40"
                                  : link.status === "over_prosecutorial"
                                  ? "bg-[#F85149]/15 text-[#F85149] border-[#F85149]/40"
                                  : "bg-[#D29922]/15 text-[#D29922] border-[#D29922]/40"
                              }`}
                            >
                              {link.status === "resonated"
                                ? "✓ Resonated in Draft"
                                : link.status === "over_prosecutorial"
                                ? "⚠ Needs Softening"
                                : "⚡ Latent Callback"}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2.5 rounded bg-[#0D1117] border-l-2 border-[#58A6FF] space-y-1">
                              <div className="text-[10px] text-[#58A6FF]">
                                EARLY PLANTING ({link.early_moment.date_or_context})
                              </div>
                              <div className="text-[#E6EDF3] leading-relaxed">
                                &ldquo;{link.early_moment.recorded_quote}&rdquo;
                              </div>
                            </div>
                            <div className="p-2.5 rounded bg-[#0D1117] border-l-2 border-[#3FB950] space-y-1">
                              <div className="text-[10px] text-[#3FB950]">
                                DOUBLE-TAKE PAYOFF ({link.later_moment.date_or_context})
                              </div>
                              <div className="text-[#E6EDF3] leading-relaxed">
                                &ldquo;{link.later_moment.recorded_quote}&rdquo;
                              </div>
                            </div>
                          </div>

                          <div className="text-xs text-[#8B949E] bg-[#0D1117] p-2.5 rounded border border-[#30363D]">
                            <strong className="text-[#58A6FF]">Voice Craft (Option D): </strong>
                            {link.narrative_editorial_analysis.journalistic_curiosity_approach}
                          </div>

                          {onApplySurgicalPatches && link.target_narrator_block_id && (
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-[#8B949E] font-mono">
                                Target Block: {link.target_narrator_block_id}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onApplySurgicalPatches(
                                    [
                                      {
                                        section_id: link.target_section_id,
                                        block_id: link.target_narrator_block_id!,
                                        updated_narrator_markdown: link.suggested_option_d_narration,
                                      },
                                    ],
                                    `Spliced Cross-Chapter Resonance Callback (${link.title})`
                                  );
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117] text-xs font-mono font-bold transition-colors"
                              >
                                <Wand2 className="w-3.5 h-3.5" />
                                <span>Audition &amp; Splice Option D Resonance</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Human Complexity & Character Arc Drawer */}
                {isComplexityOpen && secComplexityMoments.length > 0 && (
                  <div className="bg-[#0D1117] border-b border-[#30363D] p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#3FB950]">
                        <HeartHandshake className="w-4 h-4 text-[#3FB950]" />
                        <span>
                          HUMAN COMPLEXITY &amp; CHARACTER ARC AUDIT ({secComplexityMoments.length} Moment{secComplexityMoments.length > 1 ? "s" : ""})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenComplexitySectionId(null)}
                        className="text-xs text-[#8B949E] hover:text-[#E6EDF3] font-mono"
                      >
                        ✕ Close
                      </button>
                    </div>

                    <div className="space-y-3">
                      {secComplexityMoments.map((moment, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded bg-[#161B22] border border-[#30363D] space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono text-xs">
                              <span className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#3FB950]/40 text-[#3FB950] font-bold">
                                {moment.section_id}
                              </span>
                              <span className="font-bold text-[#E6EDF3]">
                                {moment.section_title}
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                moment.complexity_verdict === "humanizing_anchor"
                                  ? "bg-[#3FB950]/15 text-[#3FB950] border-[#3FB950]/40 font-bold"
                                  : moment.complexity_verdict === "nuanced"
                                  ? "bg-[#58A6FF]/15 text-[#58A6FF] border-[#58A6FF]/40"
                                  : "bg-[#D29922]/15 text-[#D29922] border-[#D29922]/40 font-bold"
                              }`}
                            >
                              {moment.complexity_verdict === "humanizing_anchor"
                                ? "★ Humanizing Anchor"
                                : moment.complexity_verdict === "nuanced"
                                ? "✓ Nuanced Treatment"
                                : "⚠ Risks Archetype"}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2.5 rounded bg-[#0D1117] border-l-2 border-[#58A6FF] space-y-1">
                              <div className="text-[10px] text-[#58A6FF] uppercase font-bold">
                                Emotional &amp; Psychological State
                              </div>
                              <div className="text-[#E6EDF3] leading-relaxed">
                                {moment.emotional_state}
                              </div>
                            </div>
                            <div className="p-2.5 rounded bg-[#0D1117] border-l-2 border-[#3FB950] space-y-1">
                              <div className="text-[10px] text-[#3FB950] uppercase font-bold">
                                Relationship Dynamic
                              </div>
                              <div className="text-[#E6EDF3] leading-relaxed">
                                {moment.relationship_status}
                              </div>
                            </div>
                          </div>

                          <div className="p-2.5 rounded bg-[#0D1117] border border-[#30363D] space-y-1 text-xs">
                            <div className="text-[10px] font-mono text-[#D29922] flex items-center gap-1 font-bold">
                              <span>Archival Evidence ({moment.primary_evidence_cue})</span>
                            </div>
                            <div className="text-[#E6EDF3] italic font-serif leading-relaxed">
                              &ldquo;{moment.evidence_quote_excerpt}&rdquo;
                            </div>
                          </div>

                          <div className="text-xs text-[#8B949E] bg-[#0D1117] p-2.5 rounded border border-[#30363D] space-y-1">
                            <div>
                              <strong className="text-[#58A6FF]">Narration Stance: </strong>
                              <span className="text-[#E6EDF3]">{moment.narrator_treatment}</span>
                            </div>
                            {moment.editorial_recommendation && (
                              <div className="pt-1 text-[#3FB950]">
                                <strong className="text-[#3FB950]">Option D Recommendation: </strong>
                                {moment.editorial_recommendation}
                              </div>
                            )}
                          </div>

                          {onApplySurgicalPatches && moment.suggested_patch && moment.target_narrator_block_id && (
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-[#8B949E] font-mono">
                                Target Block: {moment.target_narrator_block_id}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onApplySurgicalPatches(
                                    [
                                      {
                                        section_id: moment.section_id,
                                        block_id: moment.target_narrator_block_id!,
                                        updated_narrator_markdown: moment.suggested_patch!,
                                      },
                                    ],
                                    `Spliced Option D Nuance in ${moment.section_id}`
                                  );
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#3FB950] hover:bg-[#3FB950]/90 text-[#0D1117] text-xs font-mono font-bold transition-colors"
                              >
                                <Wand2 className="w-3.5 h-3.5" />
                                <span>Audition &amp; Splice Option D Nuance</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Story Arc Drawer (Narrative Intelligence) */}
                {isStoryArcOpen && arcNode && (
                  <div data-testid={`story-arc-drawer-${sec.section_id}`} className="bg-[#0D1117] border-b border-[#30363D] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-mono font-bold" style={{ color: arcColor }}>
                        <Network className="w-4 h-4" />
                        <span>
                          STORY ARC · SCENE {arcNode.index + 1} OF {storyModel.scenes.length} ·{" "}
                          {arcNode.role === "crucial_turn" ? "CRUCIAL STORY TURN" : arcNode.role === "human_texture" ? "SUPPORTING HUMAN TEXTURE" : "PACING DRAG / REDUNDANT"}
                        </span>
                      </div>
                      <button type="button" onClick={() => setOpenStoryArcSectionId(null)} className="text-xs text-[#8B949E] hover:text-[#E6EDF3] font-mono">
                        ✕ Close
                      </button>
                    </div>
                    <div className="text-xs text-[#C9D1D9] leading-relaxed">
                      {arcNode.role_reasons.join(" ")}
                    </div>
                    <div className="text-xs">
                      <span className="font-mono font-bold uppercase" style={{ color: arcColor }}>{arcNode.macro_action}</span>
                      <span className="text-[#8B949E]"> · {arcNode.macro_reason}</span>
                    </div>
                    {arcDeps.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-mono text-[#8B949E]">CONNECTED SCENES (changes here affect them)</div>
                        {arcDeps.slice(0, 8).map((d) => (
                          <div key={d.id} className="text-[11px] text-[#8B949E]">
                            <span className="font-mono text-[#58A6FF]">{d.kind}</span> {d.from_scene_id} → {d.to_scene_id}: <span className="text-[#C9D1D9]">{d.evidence.slice(0, 120)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {arcListener && (
                      <div className="space-y-1 border-t border-[#30363D] pt-2">
                        <div className="text-[10px] font-mono text-[#8B949E]">FIRST-TIME LISTENER (presented information only)</div>
                        {arcListener.primary_question && (
                          <div className="text-[11px] text-[#E6EDF3]">
                            <span className="text-[#A371F7] font-mono">Question:</span> {arcListener.primary_question.text}
                          </div>
                        )}
                        {arcListener.learned.length > 0 && (
                          <div className="text-[11px] text-[#8B949E]"><span className="text-[#3FB950] font-mono">Learns:</span> {arcListener.learned.join(" · ")}</div>
                        )}
                        {arcOpenFlags.map((f) => (
                          <div key={f.id} className="text-[11px] text-[#F0883E]">
                            ⚠ {f.kind === "unidentified_voice" ? `Unnamed voice (${f.term}) heard here` : f.kind === "unexplained_name" ? `"${f.term}" mentioned before being introduced` : f.kind === "unexplained_term" ? `Insider term "${f.term}" not explained` : f.excerpt}
                            {listenerTimeline.editorial_resolutions[f.id] ? <span className="text-[#6E7681]"> (explained only in {listenerTimeline.editorial_resolutions[f.id]})</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Tape Freshness & Hand-Off Doctor Drawer */}
                {isTapeDoctorOpen && secTapeIssues.length > 0 && (
                  <div className="bg-[#0D1117] border-b border-[#30363D] p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#D29922]">
                        <Volume2 className="w-4 h-4 text-[#D29922]" />
                        <span>
                          TAPE HAND-OFF &amp; FRESHNESS DOCTOR ({secTapeIssues.length} Issue{secTapeIssues.length > 1 ? "s" : ""})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenTapeDoctorSectionId(null)}
                        className="text-xs text-[#8B949E] hover:text-[#E6EDF3] font-mono"
                      >
                        ✕ Close
                      </button>
                    </div>

                    <div className="space-y-3">
                      {secTapeIssues.map((issue) => (
                        <div
                          key={issue.id}
                          className="p-3.5 rounded bg-[#161B22] border border-[#30363D] space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono text-xs">
                              <span className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#D29922]/40 text-[#D29922] font-bold">
                                {issue.narrator_block_id}
                              </span>
                              <span className="font-bold text-[#E6EDF3]">
                                {issue.cue_header}
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                issue.issue_type === "preemptive_lead_in_spoiler"
                                  ? "bg-[#F85149]/15 text-[#F85149] border-[#F85149]/40 font-bold"
                                  : issue.issue_type === "post_tape_over_explanation"
                                  ? "bg-[#D29922]/15 text-[#D29922] border-[#D29922]/40 font-bold"
                                  : "bg-[#A371F7]/15 text-[#A371F7] border-[#A371F7]/40 font-bold"
                              }`}
                            >
                              {issue.issue_type === "preemptive_lead_in_spoiler"
                                ? "⚠ Preemptive Lead-in Spoiler"
                                : issue.issue_type === "post_tape_over_explanation"
                                ? "⚠ Post-Tape Over-Explanation"
                                : "⚠ Pre-Judging Tone"}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2.5 rounded bg-[#0D1117] border-l-2 border-[#D29922] space-y-1">
                              <div className="text-[10px] text-[#D29922] font-bold uppercase">
                                Archival Tape (Read-Only)
                              </div>
                              <div className="text-[#E6EDF3] italic font-serif leading-relaxed">
                                &ldquo;{issue.quote_text}&rdquo;
                              </div>
                            </div>
                            <div className="p-2.5 rounded bg-[#0D1117] border-l-2 border-[#F85149] space-y-1">
                              <div className="text-[10px] text-[#F85149] font-bold uppercase">
                                Current Narrator Setup
                              </div>
                              <div className="text-[#E6EDF3] leading-relaxed">
                                {issue.narrator_text}
                              </div>
                            </div>
                          </div>

                          <div className="text-xs text-[#8B949E] bg-[#0D1117] p-2.5 rounded border border-[#30363D] space-y-1">
                            <div>
                              <strong className="text-[#58A6FF]">Diagnosis: </strong>
                              <span className="text-[#E6EDF3]">{issue.diagnosis}</span>
                            </div>
                          </div>

                          <div className="p-2.5 rounded bg-[#0D1117] border border-[#3FB950]/40 space-y-1 text-xs">
                            <span className="text-[10px] font-mono font-bold text-[#3FB950] uppercase">
                              Option D Fresh Alternative:
                            </span>
                            <pre className="text-xs font-mono text-[#E6EDF3] whitespace-pre-wrap leading-relaxed">
                              {issue.option_d_fresh_alternative}
                            </pre>
                          </div>

                          {onApplySurgicalPatches && (
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-[#8B949E] font-mono">
                                Target Block: {issue.narrator_block_id}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onApplySurgicalPatches(
                                    [
                                      {
                                        section_id: issue.section_id,
                                        block_id: issue.narrator_block_id,
                                        updated_narrator_markdown: issue.option_d_fresh_alternative,
                                      },
                                    ],
                                    `Spliced Fresh Tape Hand-off in ${issue.section_id} (${issue.issue_type})`
                                  );
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117] text-xs font-mono font-bold transition-colors"
                              >
                                <Wand2 className="w-3.5 h-3.5" />
                                <span>Audition &amp; Splice Fresh Hand-Off</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section Blocks */}
                <div className="p-4 space-y-3 font-mono text-xs leading-relaxed">
                  {sec.blocks.map((b) => {
                    if (b.type === "narrator") {
                      const isBlockPinned = pinnedBlockIds.has(b.id);
                      const echoWarning = echoByBlockId.get(b.id);
                      const isVariantsOpen = openVariantsBlockId === b.id;
                      const isLoadingVariants = loadingVariantsBlockId === b.id;
                      const blockVariants = variantsByBlockId[b.id] || [];

                      return (
                        <div key={b.id} className="space-y-2">
                          <div
                            className={`p-3.5 rounded border space-y-2 ${
                              isBlockPinned
                                ? "bg-[#0D1117] border-[#58A6FF]"
                                : echoWarning
                                ? "bg-[#0D1117] border-[#D29922]/70"
                                : wasPolished
                                ? "bg-[#2EA043]/10 border-[#3FB950]/40 text-[#E6EDF3]"
                                : "bg-[#0D1117] border-[#30363D] text-[#E6EDF3]"
                            }`}
                          >
                            {/* Block Top Mini-Toolbar */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-[#30363D]/60 text-[11px]">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[#58A6FF] font-bold">
                                  {b.id} · [Male Narrator]
                                </span>
                                {echoWarning && (
                                  <span className="flex items-center gap-1 text-[#D29922]">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>Quote-Echo Detected</span>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={isLoadingVariants || isBlockPinned}
                                  onClick={() =>
                                    void handleFetchVariantsForBlock(
                                      sec.section_id,
                                      b.id,
                                      b.rawText
                                    )
                                  }
                                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded border font-sans font-semibold text-[11px] transition-colors ${
                                    isVariantsOpen
                                      ? "bg-[#58A6FF] border-[#58A6FF] text-[#0D1117]"
                                      : "bg-[#161B22] border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3]"
                                  }`}
                                >
                                  {isLoadingVariants ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Layers className="w-3 h-3 text-[#58A6FF]" />
                                  )}
                                  <span>Showrunner Doctor</span>
                                </button>

                                {onTogglePinBlockId && (
                                  <button
                                    type="button"
                                    onClick={() => onTogglePinBlockId(b.id)}
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
                                      isBlockPinned
                                        ? "bg-[#58A6FF] border-[#58A6FF] text-[#0D1117] font-bold"
                                        : "bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
                                    }`}
                                  >
                                    <Lock className="w-3 h-3" />
                                    <span>
                                      {isBlockPinned ? "Pinned" : "Pin"}
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="whitespace-pre-wrap text-[#E6EDF3]">
                              {b.rawText}
                            </div>
                          </div>

                          {/* Showrunner Variants Picker Drawer */}
                          {isVariantsOpen && (
                            <div
                              data-testid={`variants-drawer-${b.id}`}
                              className="bg-[#0D1117] border border-[#58A6FF] rounded p-3.5 space-y-3"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-sans font-bold text-[#58A6FF] flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5" />
                                  <span>
                                    Showrunner Doctor: Select Rewrite for {b.id}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setOpenVariantsBlockId(null)}
                                  className="text-[11px] text-[#8B949E] hover:text-[#E6EDF3]"
                                >
                                  Close
                                </button>
                              </div>

                              {isLoadingVariants ? (
                                <div className="flex items-center gap-2 text-xs text-[#58A6FF] py-4">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span>
                                    Generating Showrunner rewrite styles (Option D Signature Default + Creative Alternatives)...
                                  </span>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                  {blockVariants.map((v) => {
                                    const isDefault =
                                      v.is_default ||
                                      v.style_id === "paper_trail_signature";
                                    return (
                                      <div
                                        key={v.style_id}
                                        className={`rounded p-3 flex flex-col justify-between gap-3 border transition-colors ${
                                          isDefault
                                            ? "bg-[#161B22] border-[#58A6FF] shadow-sm shadow-[#58A6FF]/10 ring-1 ring-[#58A6FF]/40"
                                            : "bg-[#161B22] border-[#30363D] hover:border-[#8B949E]"
                                        }`}
                                      >
                                        <div className="space-y-2">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="font-sans font-bold text-xs text-[#E6EDF3]">
                                                {v.style_label}
                                              </span>
                                              {isDefault && (
                                                <span className="px-1.5 py-0.2 rounded bg-[#58A6FF] text-[#0D1117] text-[9px] font-bold tracking-wide">
                                                  SIGNATURE
                                                </span>
                                              )}
                                            </div>
                                            <span className="text-[10px] font-mono text-[#8B949E]">
                                              {v.word_count_delta > 0
                                                ? `+${v.word_count_delta}w`
                                                : `${v.word_count_delta}w`}
                                            </span>
                                          </div>
                                          <p className="font-sans text-[11px] text-[#58A6FF]">
                                            {v.tagline}
                                          </p>
                                          <div className="p-2.5 rounded bg-[#0D1117] border border-[#30363D] text-[11px] text-[#E6EDF3] whitespace-pre-wrap leading-relaxed">
                                            {v.updated_narrator_markdown}
                                          </div>
                                        </div>

                                        {onApplySurgicalPatches && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              onApplySurgicalPatches(
                                                [
                                                  {
                                                    section_id: sec.section_id,
                                                    block_id: b.id,
                                                    updated_narrator_markdown:
                                                      v.updated_narrator_markdown,
                                                  },
                                                ],
                                                `Applied '${v.style_label}' to ${b.id} in [${sec.section_id}]`
                                              );
                                              setOpenVariantsBlockId(null);
                                            }}
                                            className={`w-full py-1.5 px-3 rounded font-sans font-bold text-xs transition-colors ${
                                              isDefault
                                                ? "bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117]"
                                                : "bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] border border-[#30363D]"
                                            }`}
                                          >
                                            {isDefault
                                              ? "Use Signature Style"
                                              : "Use This Variant"}
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={b.id}
                        className="p-2.5 rounded bg-[#0D1117]/50 border border-[#30363D]/60 text-[#8B949E] whitespace-pre-wrap"
                      >
                        {b.rawText}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 3: Original vs. Edited Full Script Comparison */}
      {displayMode === "compare" && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-md overflow-hidden grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#30363D] font-mono text-xs">
          <div className="p-4 space-y-2 bg-[#0D1117]/40">
            <div className="text-xs font-semibold text-[#F85149] pb-2 border-b border-[#30363D]">
              ORIGINAL DRAFT (BEFORE POLISHING)
            </div>
            <pre className="whitespace-pre-wrap break-words text-[#8B949E] leading-relaxed">
              {baselineMarkdown}
            </pre>
          </div>
          <div className="p-4 space-y-2 bg-[#0D1117]">
            <div className="text-xs font-semibold text-[#3FB950] pb-2 border-b border-[#30363D]">
              FINAL EDITED SCRIPT (AFTER POLISHING)
            </div>
            <pre
              data-testid="final-master-markdown"
              className="whitespace-pre-wrap break-words text-[#E6EDF3] leading-relaxed select-all"
            >
              {masterMarkdown}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
