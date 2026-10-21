import React, { useState } from "react";
import { Lock, SplitSquareVertical, FileDiff, Pin } from "lucide-react";
import {
  computeWordDiff,
  parseSectionBlocks,
  type SectionDiffRecord,
} from "../utils/scriptEngine";

export interface PassDiffGroup {
  passNumber: number;
  sectionDiffs: SectionDiffRecord[];
}

interface SurgicalDiffTabProps {
  passDiffGroups: PassDiffGroup[];
  focusedSectionId?: string | null;
  onSelectSectionFilter: (secId: string | null) => void;
  pinnedBlockIds: Set<string>;
  onTogglePinBlockId: (blockId: string) => void;
}

export const SurgicalDiffTab: React.FC<SurgicalDiffTabProps> = ({
  passDiffGroups,
  focusedSectionId,
  onSelectSectionFilter,
  pinnedBlockIds,
  onTogglePinBlockId,
}) => {
  const [viewMode, setViewMode] = useState<"inline" | "sideBySide">("inline");

  const nonEmptyGroups = passDiffGroups.filter(
    (g) => g.sectionDiffs.length > 0
  );

  if (nonEmptyGroups.length === 0) {
    return (
      <div className="bg-[#161B22] border border-[#30363D] rounded-md p-8 text-center">
        <p className="text-sm text-[#E6EDF3] mb-1.5 font-medium">
          No changes recorded yet
        </p>
        <p className="text-xs text-[#8B949E]">
          Click{" "}
          <span className="text-[#58A6FF] font-semibold">
            Audit &amp; Polish Script
          </span>{" "}
          to see highlighted improvements to your narrator paragraphs.
        </p>
      </div>
    );
  }

  const allModifiedSections = Array.from(
    new Set(
      nonEmptyGroups.flatMap((g) => g.sectionDiffs.map((d) => d.section_id))
    )
  );

  return (
    <div className="space-y-4">
      {/* Filter & View Mode Toolbar */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-md p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          <button
            type="button"
            onClick={() => onSelectSectionFilter(null)}
            className={`px-2.5 py-1 rounded border transition-colors whitespace-nowrap shrink-0 ${
              !focusedSectionId
                ? "bg-[#58A6FF]/15 border-[#58A6FF] text-[#E6EDF3] font-semibold"
                : "bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            All Sections ({allModifiedSections.length})
          </button>
          {allModifiedSections.map((secId) => (
            <button
              key={secId}
              type="button"
              onClick={() => onSelectSectionFilter(secId)}
              className={`px-2.5 py-1 rounded border transition-colors whitespace-nowrap shrink-0 ${
                focusedSectionId === secId
                  ? "bg-[#58A6FF]/15 border-[#58A6FF] text-[#E6EDF3] font-semibold"
                  : "bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
              }`}
            >
              [{secId}]
            </button>
          ))}
        </div>

        <div className="flex items-center bg-[#0D1117] border border-[#30363D] rounded p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("inline")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
              viewMode === "inline"
                ? "bg-[#161B22] text-[#58A6FF] font-semibold"
                : "text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            <FileDiff className="w-3.5 h-3.5" />
            Highlighted Changes
          </button>
          <button
            type="button"
            onClick={() => setViewMode("sideBySide")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
              viewMode === "sideBySide"
                ? "bg-[#161B22] text-[#58A6FF] font-semibold"
                : "text-[#8B949E] hover:text-[#E6EDF3]"
            }`}
          >
            <SplitSquareVertical className="w-3.5 h-3.5" />
            Side-by-Side
          </button>
        </div>
      </div>

      {/* Section Change Cards */}
      {nonEmptyGroups.map((group) => {
        const filteredDiffs = focusedSectionId
          ? group.sectionDiffs.filter((d) => d.section_id === focusedSectionId)
          : group.sectionDiffs;

        return (
          <div key={group.passNumber} className="space-y-4">
            {filteredDiffs.map((diff) => {
              const afterBlocks = parseSectionBlocks(
                diff.afterMarkdown,
                diff.section_id,
                false
              );
              let narratorCursor = 0;

              return (
                <div
                  key={`${group.passNumber}-${diff.section_id}`}
                  className="bg-[#161B22] border border-[#30363D] rounded-md overflow-hidden"
                >
                  <div className="px-4 py-2.5 border-b border-[#30363D] flex flex-wrap items-center justify-between gap-2 bg-[#0D1117]/60 text-xs">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-[#58A6FF]">
                        Pass {group.passNumber}
                      </span>
                      <span className="text-[#8B949E]">·</span>
                      <span className="font-bold text-[#E6EDF3]">
                        [{diff.section_id}] {diff.title}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-[#8B949E] font-mono">
                      <Lock className="w-3.5 h-3.5 text-[#3FB950]" />
                      Quotes &amp; Archival Clips Untouched
                    </span>
                  </div>

                  {viewMode === "inline" ? (
                    <div className="p-4 space-y-2.5 font-mono text-xs leading-relaxed">
                      {afterBlocks.map((block) => {
                        if (block.type === "narrator") {
                          const beforeNarrator =
                            diff.narratorBlocksBefore[narratorCursor] ?? "";
                          const afterNarrator =
                            diff.narratorBlocksAfter[narratorCursor] ??
                            block.rawText;
                          narratorCursor++;

                          const tokens = computeWordDiff(
                            beforeNarrator,
                            afterNarrator
                          );
                          const pinned = pinnedBlockIds.has(block.id);

                          return (
                            <div
                              key={block.id}
                              className="p-3 rounded bg-[#0D1117] border border-[#30363D] space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[#8B949E] pb-1 border-b border-[#30363D]">
                                <span className="text-[#58A6FF] font-semibold">
                                  Narrator Paragraph #{narratorCursor}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onTogglePinBlockId(block.id)}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                                    pinned
                                      ? "bg-[#3FB950]/15 border-[#3FB950] text-[#3FB950] font-semibold"
                                      : "bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
                                  }`}
                                >
                                  <Pin className="w-3 h-3" />
                                  <span>
                                    {pinned
                                      ? "Kept (Locked)"
                                      : "Keep This Paragraph"}
                                  </span>
                                </button>
                              </div>
                              <div className="whitespace-pre-wrap break-words leading-relaxed pt-0.5">
                                {tokens.map((tok, idx) => {
                                  if (tok.type === "added") {
                                    return (
                                      <span
                                        key={idx}
                                        className="bg-[#2EA043]/25 text-[#3FB950] px-0.5 rounded"
                                      >
                                        {tok.value}
                                      </span>
                                    );
                                  }
                                  if (tok.type === "removed") {
                                    return (
                                      <span
                                        key={idx}
                                        className="bg-[#F85149]/20 text-[#F85149] line-through px-0.5 rounded opacity-85"
                                      >
                                        {tok.value}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span key={idx} className="text-[#E6EDF3]">
                                      {tok.value}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }

                        if (block.type === "locked_meta") return null;

                        return (
                          <div
                            key={block.id}
                            className="p-2.5 rounded bg-[#0D1117]/40 border border-[#30363D]/60 text-[#8B949E]"
                          >
                            <div className="flex items-center gap-1.5 text-[10px] text-[#3FB950] mb-0.5">
                              <Lock className="w-3 h-3" />
                              <span>LOCKED QUOTE / AUDIO CUE</span>
                            </div>
                            <div className="whitespace-pre-wrap text-[#E6EDF3]/75">
                              {block.rawText}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#30363D] font-mono text-xs">
                      <div className="p-4 space-y-2 bg-[#0D1117]/50">
                        <div className="text-[11px] font-semibold text-[#F85149] pb-1 border-b border-[#30363D]">
                          ORIGINAL DRAFT
                        </div>
                        <pre className="whitespace-pre-wrap break-words text-[#8B949E] leading-relaxed">
                          {diff.beforeMarkdown}
                        </pre>
                      </div>
                      <div className="p-4 space-y-2 bg-[#0D1117]">
                        <div className="text-[11px] font-semibold text-[#3FB950] pb-1 border-b border-[#30363D]">
                          POLISHED VERSION
                        </div>
                        <pre className="whitespace-pre-wrap break-words text-[#E6EDF3] leading-relaxed">
                          {diff.afterMarkdown}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
