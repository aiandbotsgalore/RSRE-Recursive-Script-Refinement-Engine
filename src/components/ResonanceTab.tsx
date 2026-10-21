import React, { useState } from "react";
import {
  GitBranch,
  ArrowRight,
  Sparkles,
  Lock,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Wand2,
  Copy,
  Check,
  Search,
  BookOpen,
  ArrowRightLeft,
  ShieldAlert,
  Flame,
  Volume2,
} from "lucide-react";
import type {
  CrossChapterResonanceReport,
  ResonanceLinkItem,
  NarratorBlockPatch,
} from "../utils/scriptEngine";

interface ResonanceTabProps {
  resonanceReport: CrossChapterResonanceReport;
  onApplySurgicalPatches: (
    patches: NarratorBlockPatch[],
    description: string
  ) => number;
  onAskCopilotPrompt?: (prompt: string) => void;
  onJumpToSection?: (sectionId: string) => void;
}

export const ResonanceTab: React.FC<ResonanceTabProps> = ({
  resonanceReport,
  onApplySurgicalPatches,
  onAskCopilotPrompt,
  onJumpToSection,
}) => {
  const [filterType, setFilterType] = useState<"ALL" | "echo_foreshadowing" | "contradiction_evolution">("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "resonated" | "missing_link" | "over_prosecutorial">("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(
    resonanceReport.items.length > 0 ? resonanceReport.items[0].id : null
  );

  const echoCount = resonanceReport.items.filter((i) => i.type === "echo_foreshadowing").length;
  const contradictionCount = resonanceReport.items.filter((i) => i.type === "contradiction_evolution").length;

  const filteredItems = resonanceReport.items.filter((item) => {
    if (filterType !== "ALL" && item.type !== filterType) return false;
    if (filterStatus !== "ALL" && item.status !== filterStatus) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const haystack = `${item.title} ${item.motif_phrase} ${item.early_moment.section_id} ${item.later_moment.section_id} ${item.early_moment.recorded_quote} ${item.later_moment.recorded_quote}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSplice = (item: ResonanceLinkItem) => {
    if (!item.target_narrator_block_id) return;
    const count = onApplySurgicalPatches(
      [
        {
          section_id: item.target_section_id,
          block_id: item.target_narrator_block_id,
          updated_narrator_markdown: item.suggested_option_d_narration,
        },
      ],
      `Spliced Cross-Chapter Resonance: ${item.title}`
    );
    if (count > 0) {
      setAppliedIds((prev) => new Set(prev).add(item.id));
    }
  };

  return (
    <div
      data-testid="resonance-tab"
      className="bg-[#161B22] border border-[#30363D] rounded-md p-5 space-y-6"
    >
      {/* Header & Benchmark Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#58A6FF]">
              <GitBranch className="w-4 h-4 text-[#58A6FF]" />
              CROSS-CHAPTER NARRATIVE RESONANCE &amp; &ldquo;DOUBLE-TAKE&rdquo; REVELATIONS
            </span>
            <span className="text-[#484F58]">·</span>
            <span className="text-xs font-mono text-[#E6EDF3]">
              Serial / Pretend Long-Arc Storytelling Engine
            </span>
          </div>
          <p className="text-xs text-[#8B949E] leading-relaxed max-w-3xl">
            In premier investigative audio, early remarks and recorded evidence gain deeper, chilling significance when revisited later.
            The engine tracks recurring motifs and timeline evolutions across all 13 chapters, prompting Logan to weave natural, understated callbacks with journalistic curiosity rather than courtroom cross-examination.
          </p>
        </div>

        {/* Narrative Resonance Health Score Meter */}
        <div className="flex items-center gap-3 bg-[#0D1117] border border-[#30363D] rounded p-3 shrink-0">
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#8B949E]">
              Resonance Health
            </div>
            <div
              className={`text-xl font-mono font-bold tabular-nums ${
                resonanceReport.resonanceHealthScore >= 85
                  ? "text-[#3FB950]"
                  : resonanceReport.resonanceHealthScore >= 70
                  ? "text-[#58A6FF]"
                  : "text-[#D29922]"
              }`}
            >
              {resonanceReport.resonanceHealthScore.toFixed(1)}%
            </div>
          </div>
          <div className="h-8 w-px bg-[#30363D]" />
          <div className="text-[11px] font-mono text-[#8B949E] space-y-0.5">
            <div className="text-[#3FB950]">
              {resonanceReport.resonatedCount} Earned Callback(s)
            </div>
            <div className="text-[#D29922]">
              {resonanceReport.missingLinkCount} Latent Thread(s)
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        {/* Type Filter */}
        <div className="flex items-center bg-[#0D1117] border border-[#30363D] rounded p-1">
          <button
            type="button"
            onClick={() => setFilterType("ALL")}
            className={`px-3 py-1 rounded transition-colors ${
              filterType === "ALL"
                ? "bg-[#161B22] text-[#58A6FF] font-semibold border border-[#58A6FF]"
                : "text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            All Threads ({resonanceReport.totalLinks})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("echo_foreshadowing")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
              filterType === "echo_foreshadowing"
                ? "bg-[#161B22] text-[#58A6FF] font-semibold border border-[#58A6FF]"
                : "text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            <Volume2 className="w-3 h-3 text-[#58A6FF]" />
            <span>Echo &amp; Foreshadowing ({echoCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType("contradiction_evolution")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
              filterType === "contradiction_evolution"
                ? "bg-[#161B22] text-[#58A6FF] font-semibold border border-[#58A6FF]"
                : "text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            <ArrowRightLeft className="w-3 h-3 text-[#58A6FF]" />
            <span>Contradiction Evolution ({contradictionCount})</span>
          </button>
        </div>

        {/* Search & Status Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8B949E]" />
            <input
              type="text"
              placeholder="Search motif, quote, or chapter..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1 rounded bg-[#0D1117] border border-[#30363D] text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:border-[#58A6FF] text-xs w-56 font-mono"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B949E] hover:text-[#E6EDF3] text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[#8B949E]">Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className="px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D] text-[#E6EDF3] focus:outline-none focus:border-[#58A6FF]"
            >
              <option value="ALL">All Statuses ({resonanceReport.items.length})</option>
              <option value="resonated">Earned in Draft ({resonanceReport.resonatedCount})</option>
              <option value="missing_link">Latent Opportunities ({resonanceReport.missingLinkCount})</option>
              <option value="over_prosecutorial">Needs Softening ({resonanceReport.overProsecutorialCount})</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main List of Resonance Cards */}
      <div className="space-y-4">
        {filteredItems.map((item) => {
          const isExpanded = expandedId === item.id;
          const isApplied = appliedIds.has(item.id);

          return (
            <div
              key={item.id}
              data-testid={`resonance-card-${item.id}`}
              className={`bg-[#0D1117] border rounded-md transition-all ${
                isApplied
                  ? "border-[#3FB950]/80"
                  : item.status === "resonated"
                  ? "border-[#3FB950]/40"
                  : item.status === "over_prosecutorial"
                  ? "border-[#F85149]/60"
                  : "border-[#30363D]"
              }`}
            >
              {/* Card Header & Connecting Rail Summary */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-[#161B22]/50 select-none"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                    <span
                      className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                        item.type === "echo_foreshadowing"
                          ? "bg-[#58A6FF]/15 text-[#58A6FF] border border-[#58A6FF]/40"
                          : "bg-[#D29922]/15 text-[#D29922] border border-[#D29922]/40"
                      }`}
                    >
                      {item.type === "echo_foreshadowing" ? "Echo & Foreshadowing" : "Contradiction Evolution"}
                    </span>

                    <span className="text-[#E6EDF3] font-bold text-sm">
                      {item.title}
                    </span>
                  </div>

                  {/* Two-point visual rail */}
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#8B949E]">
                    <span className="px-1.5 py-0.5 rounded bg-[#161B22] text-[#58A6FF] font-semibold">
                      {item.early_moment.section_id}
                    </span>
                    <span className="text-[11px] text-[#8B949E] truncate max-w-xs">
                      &ldquo;{item.early_moment.recorded_quote.slice(0, 50)}...&rdquo;
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#58A6FF] shrink-0" />
                    <span className="px-1.5 py-0.5 rounded bg-[#161B22] text-[#3FB950] font-semibold">
                      {item.later_moment.section_id}
                    </span>
                    <span className="text-[11px] text-[#8B949E] truncate max-w-xs">
                      &ldquo;{item.later_moment.recorded_quote.slice(0, 50)}...&rdquo;
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {item.status === "resonated" || isApplied ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#3FB950]/15 border border-[#3FB950]/50 text-[#3FB950] font-mono text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Earned in Draft</span>
                    </span>
                  ) : item.status === "over_prosecutorial" ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F85149]/15 border border-[#F85149]/50 text-[#F85149] font-mono text-xs font-semibold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Needs Softening</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#D29922]/15 border border-[#D29922]/50 text-[#D29922] font-mono text-xs font-semibold">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Latent Opportunity</span>
                    </span>
                  )}
                  <span className="text-[#8B949E] text-xs">
                    {isExpanded ? "▲ Hide Details" : "▼ Inspect Double-Take"}
                  </span>
                </div>
              </div>

              {/* Expanded Deep Inspection Panel */}
              {isExpanded && (
                <div className="p-4 border-t border-[#30363D] space-y-5 bg-[#161B22]/30">
                  {/* Row 1: Side-by-Side Timeline Moments */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Early Planting */}
                    <div className="bg-[#0D1117] border border-[#30363D] rounded-md p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[#58A6FF] font-bold flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          1. THE EARLY PLANTING ({item.early_moment.section_id})
                        </span>
                        <span className="text-[#8B949E] text-[11px]">
                          {item.early_moment.date_or_context}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#8B949E]">
                        {item.early_moment.cue_header}
                      </div>
                      <div className="p-2.5 rounded bg-[#161B22] border-l-2 border-[#58A6FF] text-xs font-mono text-[#E6EDF3] leading-relaxed">
                        &ldquo;{item.early_moment.recorded_quote}&rdquo;
                      </div>
                      <div className="text-xs text-[#8B949E]">
                        <strong className="text-[#E6EDF3]">Initial Listener Take:</strong>{" "}
                        {item.early_moment.listener_understanding}
                      </div>
                    </div>

                    {/* Later Payoff / Double-Take */}
                    <div className="bg-[#0D1117] border border-[#30363D] rounded-md p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[#3FB950] font-bold flex items-center gap-1.5">
                          <Flame className="w-3.5 h-3.5" />
                          2. THE LATER DOUBLE-TAKE ({item.later_moment.section_id})
                        </span>
                        <span className="text-[#8B949E] text-[11px]">
                          {item.later_moment.date_or_context}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#8B949E]">
                        {item.later_moment.cue_header}
                      </div>
                      <div className="p-2.5 rounded bg-[#161B22] border-l-2 border-[#3FB950] text-xs font-mono text-[#E6EDF3] leading-relaxed">
                        &ldquo;{item.later_moment.recorded_quote}&rdquo;
                      </div>
                      <div className="text-xs text-[#8B949E]">
                        <strong className="text-[#3FB950]">Double-Take Revelation:</strong>{" "}
                        {item.later_moment.double_take_revelation}
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Showrunner Voice & Editorial Craft Guide */}
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-md p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#E6EDF3]">
                      <BookOpen className="w-4 h-4 text-[#58A6FF]" />
                      <span>THE SHOWRUNNER CRAFT &amp; LOGAN BLACK VOICE DIRECTIVE</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs leading-relaxed">
                      {/* Prosecutorial Trap to Avoid */}
                      <div className="p-3 rounded bg-[#F85149]/10 border border-[#F85149]/40 space-y-1">
                        <div className="font-mono font-bold text-[#F85149] flex items-center gap-1 text-[11px]">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>❌ PROSECUTORIAL CLICHÉ (DO NOT WRITE)</span>
                        </div>
                        <p className="text-[#E6EDF3]">
                          {item.narrative_editorial_analysis.prosecutorial_cliche_to_avoid}
                        </p>
                      </div>

                      {/* Option D Journalistic Curiosity Approach */}
                      <div className="p-3 rounded bg-[#58A6FF]/10 border border-[#58A6FF]/40 space-y-1">
                        <div className="font-mono font-bold text-[#58A6FF] flex items-center gap-1 text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>✅ OPTION D SIGNATURE STYLE (JOURNALISTIC CURIOSITY)</span>
                        </div>
                        <p className="text-[#E6EDF3]">
                          {item.narrative_editorial_analysis.journalistic_curiosity_approach}
                        </p>
                      </div>
                    </div>

                    <p className="text-[11px] text-[#8B949E] italic">
                      <strong>Why this matters for audio:</strong> {item.narrative_editorial_analysis.why_it_matters_for_audio}
                    </p>
                  </div>

                  {/* Row 3: Live Draft Status & One-Click Option D Splicer */}
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-md p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                      <span className="font-bold text-[#E6EDF3]">
                        TARGET NARRATOR BLOCK: [{item.target_section_id}] {item.target_narrator_block_id || "Lead-in Block"}
                      </span>
                      <span className="text-[11px] text-[#8B949E]">
                        {item.status_detail}
                      </span>
                    </div>

                    {item.current_narrator_excerpt && (
                      <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D] text-xs font-mono text-[#8B949E]">
                        <strong className="text-[#E6EDF3]">Current Excerpt in Draft: </strong>
                        &ldquo;{item.current_narrator_excerpt}...&rdquo;
                      </div>
                    )}

                    {/* Splicable Option D text */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-mono text-[#58A6FF] font-semibold flex items-center justify-between">
                        <span>OPTION D SIGNATURE NARRATION (READY TO SPLICE):</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(item.id, item.suggested_option_d_narration)}
                          className="flex items-center gap-1 text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check className="w-3 h-3 text-[#3FB950]" />
                              <span className="text-[#3FB950]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Text</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="p-3 rounded bg-[#161B22] border border-[#58A6FF]/40 text-xs font-mono text-[#E6EDF3] leading-relaxed whitespace-pre-wrap">
                        {item.suggested_option_d_narration}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="flex items-center gap-2">
                        {onJumpToSection && (
                          <button
                            type="button"
                            onClick={() => onJumpToSection(item.target_section_id)}
                            className="px-3 py-1.5 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-[#E6EDF3] text-xs font-mono transition-colors"
                          >
                            Jump to {item.target_section_id} in Master Script
                          </button>
                        )}
                        {onAskCopilotPrompt && (
                          <button
                            type="button"
                            onClick={() =>
                              onAskCopilotPrompt(
                                `Help me refine the cross-chapter resonance in ${item.target_section_id} connecting back to ${item.early_moment.section_id} regarding "${item.motif_phrase}". How can Logan introduce this with maximum investigative curiosity without sounding prosecutorial?`
                              )
                            }
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-[#58A6FF] text-xs font-mono transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Discuss with Co-Pilot</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSplice(item)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-mono font-bold transition-colors ${
                          isApplied
                            ? "bg-[#161B22] border border-[#3FB950] text-[#3FB950]"
                            : "bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117]"
                        }`}
                      >
                        {isApplied ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#3FB950]" />
                            <span>Spliced into Script ✓</span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4" />
                            <span>Audition &amp; Splice Option D Resonance</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
