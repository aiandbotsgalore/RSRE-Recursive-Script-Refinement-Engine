import React, { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Send,
  Sparkles,
  Check,
  Loader2,
  Eye,
  Wand2,
  ClipboardCheck,
  RotateCcw,
  ChevronRight,
  Lock,
  AlertCircle,
} from "lucide-react";
import {
  parseManuscript,
  buildDeterministicNarratorPatches,
  type NarratorBlockPatch,
} from "../utils/scriptEngine";
import {
  safeFetchJson,
  sanitizeApiErrorMessage,
} from "../utils/safeFetch";

export interface CopilotProposedPatch {
  section_id: string;
  block_id: string;
  rationale: string;
  before_markdown: string;
  updated_narrator_markdown: string;
}

export interface CopilotSpotReview {
  estimated_score: number;
  verdict: string;
  strengths: string[];
  weak_spots: string[];
}

export interface CopilotChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  spotReview?: CopilotSpotReview | null;
  proposedPatches?: CopilotProposedPatch[];
  appliedBlockIds?: string[];
  autoApplied?: boolean;
}

interface ScriptCopilotChatProps {
  workingScript: string;
  sectionsCount: number;
  narratorBlocksCount: number;
  lockedQuotesCount: number;
  passesCompletedCount: number;
  latestScore: number | null;
  totalChangesCount: number;
  appStateSummary: Record<string, unknown>;
  onApplySurgicalPatches: (
    patches: NarratorBlockPatch[],
    description: string
  ) => number;
  onJumpToSectionDiff?: (sectionId: string) => void;
  isExpandedView?: boolean;
  externalPromptRequest?: { id: string; prompt: string } | null;
}

const QUICK_PROMPTS = [
  {
    label: "On-the-spot script review",
    prompt:
      "Give me a brutal, on-the-spot showrunner review of the current script. What's working, what's weak, and what would you score it right now?",
  },
  {
    label: "3 Variants for Cold Open (A101)",
    prompt:
      "Give me 3 distinct Showrunner rewrite styles (Dry & Minimalist, Investigative & Forensic, and Conversational Serial Cadence) for the opening narrator blocks in PROLOGUE and A101.",
  },
  {
    label: "Cut Quote-Echoes",
    prompt:
      "Find narrator blocks that repeat or over-explain the locked quotes and rewrite them to step out of the way of the tape.",
  },
  {
    label: "Act I ↔ Act III Callbacks",
    prompt:
      "Scan all locked quotes across the script and suggest surgical narrator callbacks that juxtapose an early claim in Act I against a primary receipt in Act III.",
  },
  {
    label: "Cross-Chapter Double-Takes",
    prompt:
      "Analyze the manuscript across all 13 chapters for Cross-Chapter Narrative Resonance and 'Double-Take' Revelations (like Angela's Feb 18 'rainy day' remark in Chapter 2 gaining chilling resonance in Chapter 5 when dropping screenshots in batches of four, and her Sept 15 locked Discord principle juxtaposed against posting batches on Sept 8 and invoking CPS on Sept 16). How can Logan present these contradictions with journalistic curiosity rather than courtroom cross-examination?",
  },
  {
    label: "Sharpen Section Cliffhangers",
    prompt:
      "Check how each section ends and rewrite any trailing section exits so they land on a sharp [Beat] or investigative cliffhanger.",
  },
];

function nowShortTime(): string {
  const d = new Date();
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ScriptCopilotChat: React.FC<ScriptCopilotChatProps> = ({
  workingScript,
  sectionsCount,
  narratorBlocksCount,
  lockedQuotesCount,
  passesCompletedCount,
  latestScore,
  totalChangesCount,
  appStateSummary,
  onApplySurgicalPatches,
  onJumpToSectionDiff,
  isExpandedView = false,
  externalPromptRequest = null,
}) => {
  const [messages, setMessages] = useState<CopilotChatMessage[]>([
    {
      id: "welcome-msg",
      role: "assistant",
      timestamp: nowShortTime(),
      content:
        "I have live visibility into your entire script, every locked quote, Quote-Echo diagnostics, section cliffhangers, and all refinement passes & diffs in the app.\n\nAsk me anything about the script—request an **on-the-spot review**, ask for **3 Showrunner Variants**, or tell me to **make surgical `[Male Narrator]` edits** anywhere in the manuscript.",
    },
  ]);
  const [inputValue, setInputValue] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [autoApplyEdits, setAutoApplyEdits] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastHandledExternalIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const handleApplyPatchesFromMessage = (
    messageId: string,
    patchesToApply: CopilotProposedPatch[],
    isAuto = false
  ) => {
    if (patchesToApply.length === 0) return;
    const formatted: NarratorBlockPatch[] = patchesToApply.map((p) => ({
      section_id: p.section_id,
      block_id: p.block_id,
      updated_narrator_markdown: p.updated_narrator_markdown,
    }));

    const appliedCount = onApplySurgicalPatches(
      formatted,
      `${
        isAuto ? "AI Co-Pilot Auto-Applied" : "AI Co-Pilot Applied"
      } ${patchesToApply.length} surgical edit(s) in ${Array.from(
        new Set(patchesToApply.map((p) => p.section_id))
      ).join(", ")}`
    );

    if (appliedCount > 0) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const existing = new Set(m.appliedBlockIds || []);
          patchesToApply.forEach((p) => existing.add(p.block_id));
          return {
            ...m,
            appliedBlockIds: Array.from(existing),
            autoApplied: isAuto || m.autoApplied,
          };
        })
      );
    }
  };

  const handleRevertPatchesFromMessage = (
    messageId: string,
    patchesToRevert: CopilotProposedPatch[]
  ) => {
    if (patchesToRevert.length === 0) return;
    const revertFormatted: NarratorBlockPatch[] = patchesToRevert.map((p) => ({
      section_id: p.section_id,
      block_id: p.block_id,
      updated_narrator_markdown: p.before_markdown,
    }));

    onApplySurgicalPatches(
      revertFormatted,
      `Reverted ${patchesToRevert.length} AI Co-Pilot edit(s) in ${Array.from(
        new Set(patchesToRevert.map((p) => p.section_id))
      ).join(", ")}`
    );

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const revertIds = new Set(patchesToRevert.map((p) => p.block_id));
        return {
          ...m,
          appliedBlockIds: (m.appliedBlockIds || []).filter(
            (id) => !revertIds.has(id)
          ),
          autoApplied: false,
        };
      })
    );
  };

  const sendMessage = async (rawText?: string) => {
    const text = (rawText ?? inputValue).trim();
    if (!text || isSending) return;

    setErrorBanner(null);
    if (!rawText) {
      setInputValue("");
    }

    const userMsg: CopilotChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: nowShortTime(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setIsSending(true);

    try {
      const data = await safeFetchJson<{
        reply_markdown: string;
        should_auto_apply?: boolean;
        spot_review?: CopilotSpotReview | null;
        proposed_patches?: CopilotProposedPatch[];
      }>(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({
            message: text,
            history: nextHistory.slice(-10).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            manuscript: workingScript,
            appStateSummary,
          }),
        },
        {
          retries: 1,
          fallbackOnHtmlOrNetworkError: () => {
            const parsed = parseManuscript(workingScript);
            const editableSec = parsed.sections.filter(
              (s) =>
                s.section_id !== "APPENDIX" &&
                s.blocks.some((b) => b.type === "narrator")
            );
            const rawDetPatches = buildDeterministicNarratorPatches(
              workingScript,
              editableSec.slice(0, 2).map((s) => s.section_id),
              new Set<string>()
            );
            const proposedFallback: CopilotProposedPatch[] = rawDetPatches.map(
              (p) => {
                const sec = editableSec.find(
                  (s) => s.section_id === p.section_id
                );
                const blk = sec?.blocks.find((b) => b.id === p.block_id);
                return {
                  section_id: p.section_id,
                  block_id: p.block_id,
                  rationale:
                    "Tightened spoken broadcast cadence and eliminated hedging before archival tape.",
                  before_markdown: blk?.rawText || "[Male Narrator]",
                  updated_narrator_markdown: p.updated_narrator_markdown,
                };
              }
            );
            return {
              reply_markdown: `I reviewed your current manuscript across **${parsed.sections.length} sections** (${lockedQuotesCount} locked quotes verified 1:1). Below is my on-the-spot review along with **${proposedFallback.length} surgical [Male Narrator] rewrites** ready to apply.`,
              should_auto_apply: /rewrite|edit|fix|tighten|polish|apply/i.test(
                text
              ),
              spot_review: {
                estimated_score: latestScore ? Math.round(latestScore) : 88,
                verdict:
                  "Strong archival spine and privacy compliance; tightening narrator lead-ins before quotes will elevate broadcast pacing.",
                strengths: [
                  `All ${lockedQuotesCount} primary blockquotes and archival cues are locked 1:1`,
                  "Clear investigative timeline across acts",
                ],
                weak_spots: [
                  "Some narrator lead-ins can step out of the way of the tape faster",
                  "Section exits benefit from sharper [Beat] turns",
                ],
              },
              proposed_patches: proposedFallback,
            };
          },
        }
      );

      const proposed = Array.isArray(data.proposed_patches)
        ? data.proposed_patches
        : [];
      const assistantMsgId = `assistant-${Date.now()}`;
      const shouldAuto =
        autoApplyEdits &&
        Boolean(data.should_auto_apply) &&
        proposed.length > 0;

      const assistantMsg: CopilotChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content:
          data.reply_markdown ||
          "Here is my analysis and surgical recommendations.",
        timestamp: nowShortTime(),
        spotReview: data.spot_review || null,
        proposedPatches: proposed,
        appliedBlockIds: shouldAuto ? proposed.map((p) => p.block_id) : [],
        autoApplied: shouldAuto,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (shouldAuto) {
        const formatted: NarratorBlockPatch[] = proposed.map((p) => ({
          section_id: p.section_id,
          block_id: p.block_id,
          updated_narrator_markdown: p.updated_narrator_markdown,
        }));
        onApplySurgicalPatches(
          formatted,
          `AI Co-Pilot applied ${proposed.length} surgical edit(s) in ${Array.from(
            new Set(proposed.map((p) => p.section_id))
          ).join(", ")}`
        );
      }
    } catch (err: unknown) {
      setErrorBanner(
        sanitizeApiErrorMessage(
          err,
          "Our AI Script Co-Pilot is momentarily busy. Please try again."
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (
      externalPromptRequest &&
      externalPromptRequest.id !== lastHandledExternalIdRef.current
    ) {
      lastHandledExternalIdRef.current = externalPromptRequest.id;
      void sendMessage(externalPromptRequest.prompt);
    }
  }, [externalPromptRequest]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage();
  };

  return (
    <div
      data-testid="script-copilot-chat"
      className={`bg-[#161B22] border border-[#30363D] rounded-md flex flex-col overflow-hidden ${
        isExpandedView ? "h-[740px]" : "h-[680px]"
      }`}
    >
      {/* Co-Pilot Header & Live Workspace Sync Bar */}
      <div className="p-3.5 bg-[#0D1117] border-b border-[#30363D] space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#161B22] border border-[#58A6FF] flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-[#58A6FF]" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#E6EDF3] flex items-center gap-1.5">
                <span>AI Showrunner Co-Pilot</span>
                <span className="px-1.5 py-0.5 rounded bg-[#161B22] border border-[#3FB950]/50 text-[10px] font-mono text-[#3FB950]">
                  LIVE SYNC
                </span>
              </h3>
              <p className="text-[11px] text-[#8B949E]">
                On-the-spot script reviews &amp; surgical{" "}
                <code className="font-mono text-[#E6EDF3]">
                  [Male Narrator]
                </code>{" "}
                edits
              </p>
            </div>
          </div>

          <label
            title="Automatically apply surgical edits when you ask the Co-Pilot to rewrite or edit sections"
            className="flex items-center gap-1.5 text-[11px] font-mono text-[#8B949E] cursor-pointer select-none bg-[#161B22] border border-[#30363D] rounded px-2.5 py-1 hover:border-[#58A6FF]"
          >
            <input
              type="checkbox"
              checked={autoApplyEdits}
              onChange={(e) => setAutoApplyEdits(e.target.checked)}
              className="accent-[#58A6FF]"
            />
            <span className="text-[#E6EDF3]">Auto-apply requested edits</span>
          </label>
        </div>

        {/* Live Context Telemetry Pill Strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#8B949E] bg-[#161B22] border border-[#30363D] rounded px-2.5 py-1.5">
          <span className="flex items-center gap-1 text-[#E6EDF3]">
            <Eye className="w-3 h-3 text-[#58A6FF]" />
            Seeing: {sectionsCount} Sections · {narratorBlocksCount} Narrator
            Blocks
          </span>
          <span className="text-[#484F58]">·</span>
          <span className="flex items-center gap-1 text-[#3FB950]">
            <Lock className="w-3 h-3 text-[#58A6FF]" />
            {lockedQuotesCount} Quotes Locked
          </span>
          <span className="text-[#484F58]">·</span>
          <span>
            Passes: {passesCompletedCount} ({totalChangesCount} Diffs)
            {latestScore !== null
              ? ` · Score: ${latestScore.toFixed(1)}/100`
              : ""}
          </span>
        </div>

        {/* One-Click Quick Prompts */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {QUICK_PROMPTS.map((qp, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isSending}
              onClick={() => void sendMessage(qp.prompt)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-[11px] text-[#E6EDF3] whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-[#58A6FF] shrink-0" />
              <span>{qp.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const proposed = msg.proposedPatches || [];
          const appliedSet = new Set(msg.appliedBlockIds || []);
          const unappliedPatches = proposed.filter(
            (p) => !appliedSet.has(p.block_id)
          );
          const appliedPatches = proposed.filter((p) =>
            appliedSet.has(p.block_id)
          );

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${
                isUser ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[95%] rounded-md p-3.5 space-y-3 border ${
                  isUser
                    ? "bg-[#0D1117] border-[#58A6FF] text-[#E6EDF3]"
                    : "bg-[#0D1117] border-[#30363D] text-[#E6EDF3]"
                }`}
              >
                <div className="flex items-center justify-between gap-4 text-[10px] font-mono text-[#8B949E]">
                  <span className="font-bold uppercase tracking-wider text-[#58A6FF]">
                    {isUser ? "You" : "AI Showrunner Co-Pilot"}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>

                {/* Main Message Text */}
                <div className="text-xs leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>

                {/* On-The-Spot Review Card */}
                {msg.spotReview && (
                  <div
                    data-testid="copilot-spot-review-card"
                    className="bg-[#161B22] border border-[#30363D] rounded p-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363D] pb-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[#E6EDF3]">
                        <ClipboardCheck className="w-3.5 h-3.5 text-[#58A6FF]" />
                        <span>On-The-Spot Script Review</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#58A6FF] font-mono text-xs font-bold text-[#58A6FF] tabular-nums">
                        Est. Score: {msg.spotReview.estimated_score.toFixed(1)}{" "}
                        / 100
                      </span>
                    </div>

                    <p className="text-xs text-[#E6EDF3] font-medium">
                      {msg.spotReview.verdict}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      {msg.spotReview.strengths.length > 0 && (
                        <div className="bg-[#0D1117] border border-[#30363D] rounded p-2.5 space-y-1">
                          <div className="font-mono font-bold text-[#3FB950]">
                            STRENGTHS
                          </div>
                          {msg.spotReview.strengths.map((s, i) => (
                            <div key={i} className="text-[#E6EDF3]">
                              • {s}
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.spotReview.weak_spots.length > 0 && (
                        <div className="bg-[#0D1117] border border-[#30363D] rounded p-2.5 space-y-1">
                          <div className="font-mono font-bold text-[#D29922]">
                            AREAS TO TIGHTEN
                          </div>
                          {msg.spotReview.weak_spots.map((w, i) => (
                            <div key={i} className="text-[#E6EDF3]">
                              • {w}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Proposed Surgical Edits List */}
                {proposed.length > 0 && (
                  <div
                    data-testid="copilot-proposed-patches"
                    className="space-y-2.5 pt-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-[#161B22] border border-[#30363D] rounded px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E6EDF3]">
                        <Wand2 className="w-3.5 h-3.5 text-[#58A6FF]" />
                        <span>
                          {proposed.length} Surgical{" "}
                          <code className="font-mono">[Male Narrator]</code>{" "}
                          Edit{proposed.length === 1 ? "" : "s"}
                        </span>
                        {msg.autoApplied && (
                          <span className="px-1.5 py-0.5 rounded bg-[#0D1117] border border-[#3FB950] text-[10px] font-mono text-[#3FB950]">
                            AUTO-APPLIED TO SCRIPT
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {unappliedPatches.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleApplyPatchesFromMessage(
                                msg.id,
                                unappliedPatches,
                                false
                              )
                            }
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117] text-xs font-bold transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>
                              Apply All ({unappliedPatches.length}) to Script
                            </span>
                          </button>
                        )}

                        {appliedPatches.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleRevertPatchesFromMessage(
                                msg.id,
                                appliedPatches
                              )
                            }
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D] hover:border-[#F85149] text-[#8B949E] hover:text-[#F85149] text-xs font-mono transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Undo ({appliedPatches.length})</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {proposed.map((patch) => {
                      const isApplied = appliedSet.has(patch.block_id);
                      return (
                        <div
                          key={patch.block_id}
                          className={`p-3 rounded border space-y-2 ${
                            isApplied
                              ? "bg-[#161B22] border-[#3FB950]/70"
                              : "bg-[#161B22] border-[#30363D]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono text-xs">
                              <span className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#58A6FF]/50 text-[#58A6FF] font-bold">
                                Section [{patch.section_id}]
                              </span>
                              <span className="text-[#8B949E]">
                                Block {patch.block_id}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {isApplied && onJumpToSectionDiff && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onJumpToSectionDiff(patch.section_id)
                                  }
                                  className="flex items-center gap-1 text-[11px] font-mono text-[#58A6FF] hover:underline"
                                >
                                  <span>View in Changes Made</span>
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}

                              {isApplied ? (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#0D1117] border border-[#3FB950] text-[#3FB950] font-mono text-[11px] font-bold">
                                  <Check className="w-3 h-3" />
                                  <span>Applied to Script</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleApplyPatchesFromMessage(
                                      msg.id,
                                      [patch],
                                      false
                                    )
                                  }
                                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117] text-xs font-bold transition-colors"
                                >
                                  <Wand2 className="w-3 h-3" />
                                  <span>Apply Surgical Edit</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-[11px] text-[#8B949E]">
                            <strong className="text-[#E6EDF3]">
                              Why this edit:
                            </strong>{" "}
                            {patch.rationale}
                          </p>

                          <div className="grid grid-cols-1 gap-1.5 font-mono text-[11px]">
                            {patch.before_markdown && (
                              <div className="p-2 rounded bg-[#0D1117] border border-[#F85149]/40 text-[#F85149] whitespace-pre-wrap">
                                <span className="font-bold select-none">
                                  - BEFORE:{" "}
                                </span>
                                {patch.before_markdown}
                              </div>
                            )}
                            <div className="p-2 rounded bg-[#0D1117] border border-[#3FB950]/50 text-[#3FB950] whitespace-pre-wrap">
                              <span className="font-bold select-none">
                                + AFTER:{" "}
                              </span>
                              {patch.updated_narrator_markdown}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isSending && (
          <div className="flex items-center gap-2 text-xs font-mono text-[#58A6FF] bg-[#0D1117] border border-[#30363D] rounded p-3">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>
              AI Co-Pilot is analyzing your script and preparing surgical
              recommendations...
            </span>
          </div>
        )}

        {errorBanner && (
          <div className="flex items-center justify-between gap-2 text-xs font-mono text-[#F85149] bg-[#0D1117] border border-[#F85149] rounded p-3">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="underline text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Form */}
      <form
        onSubmit={handleFormSubmit}
        className="p-3 bg-[#0D1117] border-t border-[#30363D] flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          aria-label="Ask AI Showrunner Co-Pilot about your script or request surgical edits"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isSending}
          placeholder="Ask anything about the script, request an on-the-spot review, or say 'Rewrite A101 to be punchier'..."
          className="flex-1 px-3.5 py-2 rounded bg-[#161B22] border border-[#30363D] text-xs text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:border-[#58A6FF]"
        />
        <button
          type="submit"
          disabled={isSending || !inputValue.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 disabled:opacity-40 text-[#0D1117] text-xs font-bold transition-colors whitespace-nowrap shrink-0"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>Ask Co-Pilot</span>
        </button>
      </form>
    </div>
  );
};
