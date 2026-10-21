import React, { useState } from "react";
import {
  FileSearch,
  Clock,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  GitCompare,
  Sparkles,
  Zap,
  Loader2,
} from "lucide-react";
import type {
  ReceiptBoardReport,
  QuoteEchoReport,
  SectionCliffhangerReport,
  NarratorBlockPatch,
} from "../utils/scriptEngine";

interface ReceiptBoardTabProps {
  receiptBoard: ReceiptBoardReport;
  quoteEchoReport: QuoteEchoReport;
  cliffhangerReport: SectionCliffhangerReport;
  onApplySurgicalPatches: (
    patches: NarratorBlockPatch[],
    description: string
  ) => number;
  onRunSectionAction: (
    sectionId: string,
    action: "polish" | "cut_25" | "sharpen_lead_in"
  ) => Promise<void>;
  busySectionId: string | null;
  onAskCopilotPrompt?: (prompt: string) => void;
}

export const ReceiptBoardTab: React.FC<ReceiptBoardTabProps> = ({
  receiptBoard,
  quoteEchoReport,
  cliffhangerReport,
  onApplySurgicalPatches,
  onRunSectionAction,
  busySectionId,
  onAskCopilotPrompt,
}) => {
  const [subView, setSubView] = useState<
    "receipts" | "contradictions" | "echoes_cliffhangers"
  >("receipts");
  const [sectionFilter, setSectionFilter] = useState<string>("ALL");
  const [appliedCallbackIds, setAppliedCallbackIds] = useState<Set<string>>(
    new Set()
  );

  const uniqueSections = Array.from(
    new Set(receiptBoard.receipts.map((r) => r.section_id))
  );

  const filteredReceipts =
    sectionFilter === "ALL"
      ? receiptBoard.receipts
      : receiptBoard.receipts.filter((r) => r.section_id === sectionFilter);

  return (
    <div
      data-testid="receipt-board-tab"
      className="bg-[#161B22] border border-[#30363D] rounded-md p-5 space-y-5"
    >
      {/* Top Summary Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#58A6FF]">
              <FileSearch className="w-4 h-4" />
              THE RECEIPT BOARD — EVIDENCE &amp; TIMELINE INDEX
            </span>
            <span className="text-[#484F58]">·</span>
            <span className="text-xs font-mono text-[#3FB950] tabular-nums">
              {receiptBoard.receipts.length} Locked Primary Receipts
            </span>
            <span className="text-[#484F58]">·</span>
            <span
              className={`text-xs font-mono tabular-nums ${
                quoteEchoReport.totalEchoes === 0
                  ? "text-[#3FB950]"
                  : "text-[#D29922]"
              }`}
            >
              Quote Echoes: {quoteEchoReport.totalEchoes}
            </span>
            <span className="text-[#484F58]">·</span>
            <span
              className={`text-xs font-mono tabular-nums ${
                cliffhangerReport.needsWorkCount === 0
                  ? "text-[#3FB950]"
                  : "text-[#D29922]"
              }`}
            >
              Strong Section Exits: {cliffhangerReport.strongCount}/
              {cliffhangerReport.items.length}
            </span>
          </div>
          <p className="text-xs text-[#8B949E]">
            Cross-reference every{" "}
            <code className="font-mono text-[#E6EDF3]">[ARCHIVAL]</code> clip
            and{" "}
            <code className="font-mono text-[#E6EDF3]">&gt; &ldquo;...&rdquo;</code>{" "}
            quote, eliminate narrator quote-echoes, and pair Act I claims
            against Act III receipts.
          </p>
        </div>

        {/* Sub-view Switcher */}
        <div className="bg-[#0D1117] border border-[#30363D] rounded p-1 flex flex-wrap items-center gap-1 text-xs shrink-0">
          <button
            type="button"
            onClick={() => setSubView("receipts")}
            className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
              subView === "receipts"
                ? "bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
            }`}
          >
            Evidence Index ({receiptBoard.receipts.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView("contradictions")}
            className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
              subView === "contradictions"
                ? "bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
            }`}
          >
            Contradiction &amp; Callback Helper (
            {receiptBoard.contradictionPairs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView("echoes_cliffhangers")}
            className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
              subView === "echoes_cliffhangers"
                ? "bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-semibold"
                : "text-[#8B949E] hover:text-[#E6EDF3] border border-transparent"
            }`}
          >
            Quote-Echo &amp; Cliffhanger Check (
            {quoteEchoReport.totalEchoes + cliffhangerReport.needsWorkCount})
          </button>
        </div>
      </div>

      {/* SUBVIEW 1: EXTRACTED EVIDENCE INDEX */}
      {subView === "receipts" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
              <span className="text-[#8B949E] mr-1">Filter Section:</span>
              <button
                type="button"
                onClick={() => setSectionFilter("ALL")}
                className={`px-2.5 py-1 rounded border ${
                  sectionFilter === "ALL"
                    ? "bg-[#0D1117] border-[#58A6FF] text-[#58A6FF] font-bold"
                    : "bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
                }`}
              >
                ALL ({receiptBoard.receipts.length})
              </button>
              {uniqueSections.map((secId) => (
                <button
                  key={secId}
                  type="button"
                  onClick={() => setSectionFilter(secId)}
                  className={`px-2.5 py-1 rounded border ${
                    sectionFilter === secId
                      ? "bg-[#0D1117] border-[#58A6FF] text-[#58A6FF] font-bold"
                      : "bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
                  }`}
                >
                  {secId}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredReceipts.map((rec) => {
              const isBusy = busySectionId === rec.section_id;
              return (
                <div
                  key={rec.receipt_id}
                  className={`p-4 rounded bg-[#0D1117] border space-y-2.5 ${
                    rec.has_quote_echo
                      ? "border-[#D29922]"
                      : "border-[#30363D]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-bold">
                        {rec.receipt_id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#30363D] text-[#E6EDF3] font-semibold">
                        Section [{rec.section_id}]
                      </span>
                      <span className="flex items-center gap-1 text-[#8B949E]">
                        <Clock className="w-3 h-3 text-[#58A6FF]" />
                        {rec.extracted_timestamp}
                      </span>
                      <span className="text-[#484F58]">·</span>
                      <span className="text-[#E6EDF3] font-semibold">
                        {rec.speaker_or_source}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {rec.has_quote_echo ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#161B22] border border-[#D29922] text-[11px] font-mono text-[#D29922]">
                          <AlertTriangle className="w-3 h-3" />
                          <span>QUOTE ECHO DETECTED</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#161B22] border border-[#3FB950]/50 text-[11px] font-mono text-[#3FB950]">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>CLEAN TAPE SETUP</span>
                        </span>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void onRunSectionAction(
                            rec.section_id,
                            "sharpen_lead_in"
                          )
                        }
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161B22] border border-[#30363D] hover:border-[#58A6FF] text-xs font-mono text-[#E6EDF3] transition-colors disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin text-[#58A6FF]" />
                        ) : (
                          <Wand2 className="w-3 h-3 text-[#58A6FF]" />
                        )}
                        <span>Sharpen Setup in [{rec.section_id}]</span>
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-[#58A6FF]">
                    {rec.cue_header}
                  </div>

                  <div className="p-3 rounded bg-[#161B22] border-l-2 border-[#3FB950] font-mono text-xs text-[#E6EDF3] leading-relaxed">
                    <div className="flex items-center gap-1 text-[10px] text-[#3FB950] mb-1">
                      <Lock className="w-3 h-3" />
                      <span>LOCKED PRIMARY EVIDENCE QUOTE</span>
                    </div>
                    &ldquo;{rec.quote_text}&rdquo;
                  </div>

                  {rec.adjacent_narrator_preview && (
                    <div className="text-xs font-mono text-[#8B949E] bg-[#161B22]/60 border border-[#30363D] rounded p-2.5">
                      <span className="text-[#E6EDF3] font-bold">
                        Adjacent Narrator ({rec.adjacent_narrator_block_id}):{" "}
                      </span>
                      {rec.adjacent_narrator_preview}
                    </div>
                  )}

                  {rec.echo_warning && (
                    <div className="text-xs font-mono text-[#D29922] bg-[#161B22] border border-[#D29922]/60 rounded p-2.5">
                      <strong>Showrunner Fix Order:</strong> {rec.echo_warning}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUBVIEW 2: CONTRADICTION & CALLBACK HELPER */}
      {subView === "contradictions" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0D1117] border border-[#30363D] rounded p-3.5">
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-[#E6EDF3] flex items-center gap-1.5">
                <GitCompare className="w-4 h-4 text-[#58A6FF]" />
                <span>
                  Act I &leftrightarrow; Act III Contradiction &amp; Callback
                  Engine
                </span>
              </div>
              <p className="text-xs text-[#8B949E]">
                Juxtapose early rules or claims in your script against later
                timestamped receipts so the listener hears the contradiction
                land.
              </p>
            </div>

            {onAskCopilotPrompt && (
              <button
                type="button"
                onClick={() =>
                  onAskCopilotPrompt(
                    "Scan all locked quotes across the script and suggest surgical narrator callbacks that juxtapose an early claim in Act I against a primary receipt in Act III."
                  )
                }
                className="flex items-center gap-1.5 px-3.5 py-2 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117] text-xs font-bold transition-colors shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Ask AI Co-Pilot to Find More Callbacks</span>
              </button>
            )}
          </div>

          <div className="space-y-3">
            {receiptBoard.contradictionPairs.map((pair) => {
              const isApplied = appliedCallbackIds.has(pair.pair_id);
              return (
                <div
                  key={pair.pair_id}
                  className="p-4 rounded bg-[#0D1117] border border-[#30363D] space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-bold">
                        {pair.early_section_id} ({pair.early_receipt_id})
                        &rarr; {pair.later_section_id} ({pair.later_receipt_id})
                      </span>
                      <span className="text-[#8B949E]">
                        Target Narrator Block: {pair.target_narrator_block_id}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isApplied}
                      onClick={() => {
                        const count = onApplySurgicalPatches(
                          [
                            {
                              section_id: pair.later_section_id,
                              block_id: pair.target_narrator_block_id,
                              updated_narrator_markdown:
                                pair.suggested_callback_narrator_markdown,
                            },
                          ],
                          `Spliced Act-to-Act contradiction callback (${pair.early_section_id} -> ${pair.later_section_id})`
                        );
                        if (count > 0) {
                          setAppliedCallbackIds((prev) =>
                            new Set(prev).add(pair.pair_id)
                          );
                        }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                        isApplied
                          ? "bg-[#161B22] border border-[#3FB950] text-[#3FB950]"
                          : "bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117]"
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {isApplied
                          ? "Callback Spliced Into Script ✓"
                          : `Splice Callback Into [${pair.later_section_id}]`}
                      </span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                    <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D]">
                      <div className="font-mono font-bold text-[#58A6FF] mb-1">
                        1. EARLIER ANCHOR [{pair.early_section_id}]
                      </div>
                      <p className="text-[#E6EDF3] font-mono text-[11px]">
                        {pair.early_claim_summary}
                      </p>
                    </div>
                    <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D]">
                      <div className="font-mono font-bold text-[#3FB950] mb-1">
                        2. LATER PAYOFF [{pair.later_section_id}]
                      </div>
                      <p className="text-[#E6EDF3] font-mono text-[11px]">
                        {pair.contradiction_payoff}
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-[#161B22] border border-[#3FB950]/50 font-mono text-xs text-[#3FB950] whitespace-pre-wrap">
                    <span className="font-bold select-none">
                      SUGGESTED CALLBACK NARRATION:{" "}
                    </span>
                    {pair.suggested_callback_narrator_markdown}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUBVIEW 3: QUOTE-ECHO SCANNER & ACT-BY-ACT CLIFFHANGER CHECK */}
      {subView === "echoes_cliffhangers" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Column 1: Quote-Echo Scanner */}
          <div className="bg-[#0D1117] border border-[#30363D] rounded p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#30363D] pb-2.5">
              <div className="text-xs font-mono font-bold text-[#E6EDF3]">
                DETERMINISTIC QUOTE-ECHO SCANNER
              </div>
              <span
                className={`px-2 py-0.5 rounded font-mono text-xs font-bold ${
                  quoteEchoReport.totalEchoes === 0
                    ? "bg-[#161B22] border border-[#3FB950] text-[#3FB950]"
                    : "bg-[#161B22] border border-[#D29922] text-[#D29922]"
                }`}
              >
                {quoteEchoReport.totalEchoes === 0
                  ? "0 ECHOES (ALL CLEAN)"
                  : `${quoteEchoReport.totalEchoes} ECHO(ES) FOUND`}
              </span>
            </div>

            {quoteEchoReport.echoes.length === 0 ? (
              <div className="p-4 rounded bg-[#161B22] border border-[#30363D] text-xs text-[#3FB950] font-mono">
                Every [Male Narrator] setup and exit steps cleanly out of the
                way of your locked quotes without repeating phrases.
              </div>
            ) : (
              quoteEchoReport.echoes.map((echo) => (
                <div
                  key={echo.narrator_block_id}
                  className="p-3 rounded bg-[#161B22] border border-[#D29922]/60 space-y-2 text-xs font-mono"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#D29922]">
                      Section [{echo.section_id}] · {echo.narrator_block_id} (
                      {echo.position === "lead_in" ? "Lead-In" : "Post-Quote"})
                    </span>
                    <button
                      type="button"
                      disabled={busySectionId === echo.section_id}
                      onClick={() =>
                        void onRunSectionAction(
                          echo.section_id,
                          "sharpen_lead_in"
                        )
                      }
                      className="px-2.5 py-1 rounded bg-[#58A6FF] text-[#0D1117] font-sans font-bold text-[11px] hover:bg-[#58A6FF]/90 disabled:opacity-50"
                    >
                      Cut Echo in [{echo.section_id}]
                    </button>
                  </div>
                  <div className="text-[11px] text-[#8B949E]">
                    Repeated words/phrases:{" "}
                    <span className="text-[#E6EDF3]">
                      {echo.repeated_phrases.join(", ")}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#E6EDF3]">
                    {echo.editorial_fix_directive}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Column 2: Act-by-Act Tension & Cliffhanger Check */}
          <div className="bg-[#0D1117] border border-[#30363D] rounded p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#30363D] pb-2.5">
              <div className="text-xs font-mono font-bold text-[#E6EDF3]">
                ACT-BY-ACT TENSION &amp; CLIFFHANGER CHECK
              </div>
              <span className="px-2 py-0.5 rounded bg-[#161B22] border border-[#58A6FF] text-[#58A6FF] font-mono text-xs font-bold">
                {cliffhangerReport.strongCount}/{cliffhangerReport.items.length}{" "}
                STRONG TURNS
              </span>
            </div>

            <div className="space-y-2.5">
              {cliffhangerReport.items.map((item) => {
                const isStrong = item.status === "strong_turn";
                return (
                  <div
                    key={item.section_id}
                    className={`p-3 rounded bg-[#161B22] border space-y-1.5 font-mono text-xs ${
                      isStrong ? "border-[#30363D]" : "border-[#D29922]/70"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-[#E6EDF3]">
                        [{item.section_id}] {item.title}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-bold ${
                            isStrong ? "text-[#3FB950]" : "text-[#D29922]"
                          }`}
                        >
                          {item.turn_type}
                        </span>
                        {!isStrong && (
                          <button
                            type="button"
                            disabled={busySectionId === item.section_id}
                            onClick={() =>
                              void onRunSectionAction(
                                item.section_id,
                                "polish"
                              )
                            }
                            className="px-2 py-0.5 rounded bg-[#58A6FF] text-[#0D1117] font-sans font-bold text-[11px]"
                          >
                            Sharpen Exit
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-[#8B949E] italic">
                      &ldquo;{item.closing_excerpt}&rdquo;
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
