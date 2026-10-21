import React, { useState } from "react";
import {
  Volume2,
  Headphones,
  Mic,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Wand2,
  Copy,
  Check,
  Search,
  BookOpen,
  ArrowRight,
  ShieldAlert,
  Flame,
  MessageSquare,
  PlayCircle,
} from "lucide-react";
import type {
  TapeFreshnessReport,
  TapeHandOffIssue,
  NarratorBlockPatch,
} from "../utils/scriptEngine";

interface TapeDoctorTabProps {
  tapeFreshnessReport: TapeFreshnessReport;
  onApplySurgicalPatches: (
    patches: NarratorBlockPatch[],
    description: string
  ) => number;
  onAskCopilotPrompt?: (prompt: string) => void;
  onJumpToSection?: (sectionId: string) => void;
}

export const TapeDoctorTab: React.FC<TapeDoctorTabProps> = ({
  tapeFreshnessReport,
  onApplySurgicalPatches,
  onAskCopilotPrompt,
  onJumpToSection,
}) => {
  const [filterType, setFilterType] = useState<
    "ALL" | "preemptive_lead_in_spoiler" | "post_tape_over_explanation" | "pre_judging_tone"
  >("ALL");
  const [filterSeverity, setFilterSeverity] = useState<"ALL" | "high" | "medium">("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(
    tapeFreshnessReport.issues.length > 0 ? tapeFreshnessReport.issues[0].id : null
  );

  const filteredIssues = tapeFreshnessReport.issues.filter((issue) => {
    if (filterType !== "ALL" && issue.issue_type !== filterType) return false;
    if (filterSeverity !== "ALL" && issue.severity !== filterSeverity) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const haystack = `${issue.section_id} ${issue.cue_header} ${issue.narrator_text} ${issue.quote_text} ${issue.diagnosis} ${issue.spoiled_elements.join(" ")}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSpliceIssue = (issue: TapeHandOffIssue) => {
    const count = onApplySurgicalPatches(
      [
        {
          section_id: issue.section_id,
          block_id: issue.narrator_block_id,
          updated_narrator_markdown: issue.option_d_fresh_alternative,
        },
      ],
      `Spliced Fresh Tape Hand-off in ${issue.section_id} (${issue.issue_type})`
    );
    if (count > 0) {
      setAppliedIds((prev) => new Set(prev).add(issue.id));
    }
  };

  const handleSpliceAll = () => {
    const patches: NarratorBlockPatch[] = filteredIssues.map((issue) => ({
      section_id: issue.section_id,
      block_id: issue.narrator_block_id,
      updated_narrator_markdown: issue.option_d_fresh_alternative,
    }));
    const count = onApplySurgicalPatches(
      patches,
      `Batch Spliced ${patches.length} Fresh Tape Hand-Offs (Option D)`
    );
    if (count > 0) {
      setAppliedIds(new Set(filteredIssues.map((i) => i.id)));
    }
  };

  return (
    <div
      data-testid="tape-doctor-tab"
      className="bg-[#161B22] border border-[#30363D] rounded-md p-5 space-y-6"
    >
      {/* Header & Benchmark Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#58A6FF]">
              <Volume2 className="w-4 h-4 text-[#58A6FF]" />
              TAPE HAND-OFF &amp; FRESHNESS DOCTOR
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#238636]/20 border border-[#238636]/50 text-[#3FB950] font-semibold">
              Option D • Serial/Pretend Benchmark
            </span>
          </div>
          <h2 className="text-xl font-bold text-[#E6EDF3] tracking-tight">
            Lead-in Freshness &amp; Post-Tape Over-Explanation Audit
          </h2>
          <p className="text-xs text-[#8B949E] max-w-4xl leading-relaxed">
            The tape should land with maximum punch; narration should never spoil or drain the
            moment. In premium investigative audio, narration sets up the context, mindset, and
            stakes without pre-empting the punchline or repeating what the listener just clearly heard.
          </p>
        </div>

        {/* Quick Metrics Cards */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Freshness
            </div>
            <div
              className={`text-lg font-bold font-mono ${
                tapeFreshnessReport.freshnessScore >= 90
                  ? "text-[#3FB950]"
                  : tapeFreshnessReport.freshnessScore >= 75
                  ? "text-[#D29922]"
                  : "text-[#F85149]"
              }`}
            >
              {tapeFreshnessReport.freshnessScore}%
            </div>
          </div>
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Tape Cues
            </div>
            <div className="text-lg font-bold font-mono text-[#58A6FF]">
              {tapeFreshnessReport.totalTapeHandoffs}
            </div>
          </div>
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Clean Cues
            </div>
            <div className="text-lg font-bold font-mono text-[#3FB950]">
              {tapeFreshnessReport.cleanHandoffsCount}
            </div>
          </div>
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Spoilers
            </div>
            <div
              className={`text-lg font-bold font-mono ${
                tapeFreshnessReport.preemptiveSpoilersCount === 0
                  ? "text-[#3FB950]"
                  : "text-[#F85149]"
              }`}
            >
              {tapeFreshnessReport.preemptiveSpoilersCount}
            </div>
          </div>
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Recaps
            </div>
            <div
              className={`text-lg font-bold font-mono ${
                tapeFreshnessReport.postTapeRecapsCount === 0
                  ? "text-[#3FB950]"
                  : "text-[#D29922]"
              }`}
            >
              {tapeFreshnessReport.postTapeRecapsCount}
            </div>
          </div>
        </div>
      </div>

      {/* Craft Principles Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-[#0D1117] border border-[#30363D] space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#58A6FF]">
            <Headphones className="w-4 h-4 text-[#58A6FF]" />
            <span>1. LEAD-IN FRESHNESS AUDIT (THE SERIAL BENCHMARK)</span>
          </div>
          <p className="text-xs text-[#8B949E] leading-relaxed">
            Never announce what the tape is about to say (e.g. telling the audience &ldquo;Angela was
            about to threaten to ruin my friends&rdquo; right before she speaks). Set up the context,
            the room temperature, and the stakes — then let the listener experience the tape firsthand.
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1117] border border-[#30363D] space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#3FB950]">
            <Mic className="w-4 h-4 text-[#3FB950]" />
            <span>2. POST-TAPE OVER-EXPLANATION CHECK</span>
          </div>
          <p className="text-xs text-[#8B949E] leading-relaxed">
            Avoid paraphrasing or summarizing a recording right after it plays (e.g. &ldquo;In other
            words, what she meant was...&rdquo;). Trust the audience. Let the tape breathe with a
            reflective reaction, a quiet realization, or deliberate silence `[Beat]`.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded bg-[#0D1117] border border-[#30363D]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-[#8B949E]">Filter:</span>

          <button
            type="button"
            onClick={() => setFilterType("ALL")}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              filterType === "ALL"
                ? "bg-[#58A6FF] text-[#0D1117] font-bold"
                : "bg-[#161B22] text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            All Issues ({tapeFreshnessReport.issues.length})
          </button>

          <button
            type="button"
            onClick={() => setFilterType("preemptive_lead_in_spoiler")}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              filterType === "preemptive_lead_in_spoiler"
                ? "bg-[#F85149] text-[#0D1117] font-bold"
                : "bg-[#161B22] text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            Lead-in Spoilers ({tapeFreshnessReport.preemptiveSpoilersCount})
          </button>

          <button
            type="button"
            onClick={() => setFilterType("post_tape_over_explanation")}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              filterType === "post_tape_over_explanation"
                ? "bg-[#D29922] text-[#0D1117] font-bold"
                : "bg-[#161B22] text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            Post-Tape Recaps ({tapeFreshnessReport.postTapeRecapsCount})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8B949E] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search tape issues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1 bg-[#161B22] border border-[#30363D] rounded text-xs text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:border-[#58A6FF]"
            />
          </div>

          {filteredIssues.length > 0 && (
            <button
              type="button"
              onClick={handleSpliceAll}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#238636] hover:bg-[#2EA043] text-[#FFFFFF] text-xs font-mono font-bold transition-colors whitespace-nowrap"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Splice All ({filteredIssues.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Issues List or Clean State */}
      {filteredIssues.length === 0 ? (
        <div className="p-8 rounded-lg bg-[#0D1117] border border-[#238636]/40 text-center space-y-3">
          <div className="flex justify-center">
            <span className="p-3 rounded-full bg-[#238636]/20 text-[#3FB950]">
              <CheckCircle2 className="w-8 h-8 text-[#3FB950]" />
            </span>
          </div>
          <h3 className="text-base font-bold text-[#E6EDF3]">
            All Archival Tape Handoffs Are Fresh &amp; Punchy!
          </h3>
          <p className="text-xs text-[#8B949E] max-w-xl mx-auto leading-relaxed">
            No preemptive lead-in spoilers or redundant post-tape recaps were detected in the
            active draft. Narration provides strong context without diluting the raw audio impact.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIssues.map((issue) => {
            const isApplied = appliedIds.has(issue.id);
            const isExpanded = expandedId === issue.id;

            return (
              <div
                key={issue.id}
                className="p-4 rounded-lg bg-[#0D1117] border border-[#30363D] space-y-4 hover:border-[#8B949E] transition-colors"
              >
                {/* Issue Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#30363D]">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#58A6FF]/40 text-[#58A6FF] font-bold">
                      {issue.section_id}
                    </span>
                    <span className="text-[#8B949E]">Target Block: {issue.narrator_block_id}</span>
                    <span className="text-xs text-[#E6EDF3] font-bold">
                      {issue.cue_header}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        issue.issue_type === "preemptive_lead_in_spoiler"
                          ? "bg-[#F85149]/20 border-[#F85149]/50 text-[#F85149] font-bold"
                          : issue.issue_type === "post_tape_over_explanation"
                          ? "bg-[#D29922]/20 border-[#D29922]/50 text-[#D29922] font-bold"
                          : "bg-[#A371F7]/20 border-[#A371F7]/50 text-[#A371F7] font-bold"
                      }`}
                    >
                      {issue.issue_type === "preemptive_lead_in_spoiler"
                        ? "⚠ Preemptive Lead-in Spoiler"
                        : issue.issue_type === "post_tape_over_explanation"
                        ? "⚠ Post-Tape Over-Explanation"
                        : "⚠ Pre-Judging Tone"}
                    </span>
                  </div>
                </div>

                {/* Side-by-side Tape & Current Narration */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  {/* The Archival Tape (Read-only) */}
                  <div className="p-3 rounded bg-[#161B22] border-l-2 border-[#D29922] space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[#D29922] font-bold uppercase">
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-3 h-3" />
                        Original Archival Tape (Untouched)
                      </span>
                    </div>
                    <div className="text-[#E6EDF3] italic font-serif leading-relaxed">
                      &ldquo;{issue.quote_text}&rdquo;
                    </div>
                  </div>

                  {/* Current Problematic Narration */}
                  <div className="p-3 rounded bg-[#161B22] border-l-2 border-[#F85149] space-y-1">
                    <div className="text-[10px] text-[#F85149] font-bold uppercase">
                      Current Narrator Setup (Drains Tape Impact)
                    </div>
                    <div className="text-[#E6EDF3] leading-relaxed">
                      {issue.narrator_text}
                    </div>
                    <div className="text-[10px] text-[#8B949E] pt-1">
                      <strong className="text-[#F85149]">Spoiled Elements: </strong>
                      {issue.spoiled_elements.join(", ")}
                    </div>
                  </div>
                </div>

                {/* Editorial Diagnosis */}
                <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D] text-xs text-[#8B949E] space-y-1">
                  <div>
                    <strong className="text-[#58A6FF]">Showrunner Diagnosis: </strong>
                    <span className="text-[#E6EDF3]">{issue.diagnosis}</span>
                  </div>
                </div>

                {/* Option D Fresh Alternative */}
                <div className="p-3 rounded bg-[#161B22] border border-[#3FB950]/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold text-[#3FB950] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#3FB950]" />
                      Option D Fresh Alternative (Maintains Suspense &amp; Freshness):
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(issue.id, issue.option_d_fresh_alternative)}
                      className="text-[10px] font-mono text-[#8B949E] hover:text-[#E6EDF3] flex items-center gap-1"
                    >
                      {copiedId === issue.id ? (
                        <>
                          <Check className="w-3 h-3 text-[#3FB950]" />
                          <span className="text-[#3FB950]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="text-xs font-mono text-[#E6EDF3] bg-[#0D1117] p-2.5 rounded border border-[#30363D] whitespace-pre-wrap leading-relaxed">
                    {issue.option_d_fresh_alternative}
                  </pre>
                </div>

                {/* Actions Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-3">
                    {onJumpToSection && (
                      <button
                        type="button"
                        onClick={() => onJumpToSection(issue.section_id)}
                        className="flex items-center gap-1 text-xs font-mono text-[#58A6FF] hover:underline"
                      >
                        <span>Jump to {issue.section_id}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {onAskCopilotPrompt && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskCopilotPrompt(
                            `Review the tape hand-off in ${issue.section_id} for block ${issue.narrator_block_id}. How can we build more psychological suspense before '${issue.quote_text.slice(0, 50)}...' without spoiling the reveal?`
                          )
                        }
                        className="flex items-center gap-1 text-xs font-mono text-[#8B949E] hover:text-[#E6EDF3]"
                      >
                        <MessageSquare className="w-3 h-3 text-[#58A6FF]" />
                        <span>Discuss with Co-Pilot</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSpliceIssue(issue)}
                    disabled={isApplied}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors ${
                      isApplied
                        ? "bg-[#238636]/30 text-[#3FB950] border border-[#238636]/50 cursor-default"
                        : "bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117]"
                    }`}
                  >
                    {isApplied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Spliced into Script</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Audition &amp; Splice Fresh Hand-off</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
