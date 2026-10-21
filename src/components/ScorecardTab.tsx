import React from "react";
import {
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  FileCheck2,
  Sparkles,
} from "lucide-react";
import type {
  AuditorReport,
  CueIntegrityReport,
  PrivacyScanResult,
} from "../utils/scriptEngine";

export interface PassRecord {
  passNumber: number;
  auditorReport: AuditorReport;
  privacyScan: PrivacyScanResult;
  cueIntegrity: CueIntegrityReport;
  lockedActsAfterPass: string[];
  editorChangelog: string[];
  guardrailEvents: string[];
  scriptSnapshotAfterPass: string;
  sectionDiffsCount: number;
  mode: string;
}

interface ScorecardTabProps {
  passes: PassRecord[];
  selectedPassIndex: number;
  onSelectPass: (idx: number) => void;
  targetScore: number;
  isRunning: boolean;
  currentStepLabel: string;
  onJumpToDiff: (sectionId?: string) => void;
}

const METRIC_LABELS: Array<{
  key: keyof AuditorReport["metrics"];
  title: string;
}> = [
  { key: "narrative_drive", title: "1. Narrative Journey & Ear-Pacing" },
  { key: "spoken_cadence", title: "2. Authentic Firsthand Voice (Logan Black)" },
  { key: "tape_integration", title: "3. Audio-Tape Integration & Scene Economy" },
  { key: "investigative_authority", title: "4. Human Complexity & Factual Integrity" },
  { key: "narrator_composure", title: "5. Earned Revelations & Narrative Purpose" },
];

export const ScorecardTab: React.FC<ScorecardTabProps> = ({
  passes,
  selectedPassIndex,
  onSelectPass,
  targetScore,
  isRunning,
  currentStepLabel,
  onJumpToDiff,
}) => {
  if (passes.length === 0) {
    return (
      <div className="bg-[#161B22] border border-[#30363D] rounded-md p-8 text-center">
        <p className="text-sm text-[#E6EDF3] mb-1.5 font-medium">
          No quality score yet
        </p>
        <p className="text-xs text-[#8B949E]">
          Click{" "}
          <span className="text-[#58A6FF] font-semibold">
            Audit &amp; Polish Script
          </span>{" "}
          above to evaluate and refine your script.
        </p>
      </div>
    );
  }

  const activePass = passes[selectedPassIndex] || passes[passes.length - 1];
  const { auditorReport, cueIntegrity } = activePass;

  return (
    <div className="space-y-4">
      {/* Pass Progression & Overall Score */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 mb-3 border-b border-[#30363D]">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {passes.map((p, idx) => {
              const isSelected = idx === selectedPassIndex;
              const passed = p.auditorReport.passed_threshold;
              return (
                <React.Fragment key={p.passNumber}>
                  <button
                    type="button"
                    onClick={() => onSelectPass(idx)}
                    className={`px-3 py-1.5 rounded border font-mono transition-colors whitespace-nowrap shrink-0 ${
                      isSelected
                        ? "bg-[#58A6FF]/15 border-[#58A6FF] text-[#E6EDF3] font-semibold"
                        : "bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
                    }`}
                  >
                    Pass {p.passNumber}:{" "}
                    {p.auditorReport.composite_score.toFixed(1)}/100
                    {passed ? " ✓" : ""}
                  </button>
                  {idx < passes.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 text-[#8B949E] shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
            {isRunning && (
              <span className="text-xs font-mono text-[#58A6FF] px-2.5 py-1 bg-[#0D1117] border border-[#30363D] rounded">
                {currentStepLabel || "Working..."}
              </span>
            )}
          </div>

          <div className="flex items-center gap-6 font-mono">
            <div className="text-right">
              <div className="text-[11px] text-[#8B949E]">OVERALL SCORE</div>
              <div
                className={`text-lg font-bold tabular-nums ${
                  auditorReport.composite_score >= targetScore
                    ? "text-[#3FB950]"
                    : "text-[#D29922]"
                }`}
              >
                {auditorReport.composite_score.toFixed(1)}
                <span className="text-xs font-normal text-[#8B949E]">
                  /100 (Goal {targetScore})
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#8B949E]">LOWEST CATEGORY</div>
              <div
                className={`text-lg font-bold tabular-nums ${
                  auditorReport.min_category_score >= 18
                    ? "text-[#3FB950]"
                    : "text-[#D29922]"
                }`}
              >
                {auditorReport.min_category_score.toFixed(1)}
                <span className="text-xs font-normal text-[#8B949E]">/20</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[#8B949E]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-[#E6EDF3]">
              {auditorReport.privacy_and_tag_audit.privacy_gate_passed ? (
                <ShieldCheck className="w-3.5 h-3.5 text-[#3FB950]" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-[#F85149]" />
              )}
              Privacy:{" "}
              <strong
                className={
                  auditorReport.privacy_and_tag_audit.privacy_gate_passed
                    ? "text-[#3FB950]"
                    : "text-[#F85149]"
                }
              >
                {auditorReport.privacy_and_tag_audit.privacy_gate_passed
                  ? "PASS"
                  : "FAIL"}
              </strong>
            </span>
            <span className="flex items-center gap-1.5 text-[#E6EDF3]">
              <FileCheck2
                className={`w-3.5 h-3.5 ${
                  cueIntegrity.tag_integrity
                    ? "text-[#3FB950]"
                    : "text-[#F85149]"
                }`}
              />
              Quotes &amp; Audio Cues:{" "}
              <strong
                className={
                  cueIntegrity.tag_integrity
                    ? "text-[#3FB950]"
                    : "text-[#F85149]"
                }
              >
                {cueIntegrity.tag_integrity ? "LOCKED" : "CHANGED"}
              </strong>
            </span>
          </div>

          {activePass.sectionDiffsCount > 0 && (
            <button
              type="button"
              onClick={() => onJumpToDiff()}
              className="text-xs font-mono text-[#58A6FF] hover:underline whitespace-nowrap shrink-0"
            >
              View {activePass.sectionDiffsCount} Polished Section(s) →
            </button>
          )}
        </div>
      </div>

      {/* 5 Quality Breakdown Categories */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-md divide-y divide-[#30363D]">
        {METRIC_LABELS.map(({ key, title }) => {
          const metric = auditorReport.metrics[key];
          const score = metric?.score ?? 0;
          const meetsFloor = score >= 18;
          return (
            <div
              key={key}
              className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
            >
              <div className="space-y-1 flex-1">
                <div className="text-xs font-semibold text-[#E6EDF3]">
                  {title}
                </div>
                <p className="text-xs text-[#8B949E] leading-relaxed">
                  {metric?.brutal_critique}
                </p>
              </div>
              <div className="sm:w-24 shrink-0 flex sm:flex-col items-center sm:items-end justify-between font-mono">
                <span
                  className={`text-base font-bold tabular-nums ${
                    meetsFloor ? "text-[#3FB950]" : "text-[#D29922]"
                  }`}
                >
                  {score.toFixed(1)}
                  <span className="text-xs font-normal text-[#8B949E]">
                    /20
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editorial Revision Notes */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#58A6FF]" />
            <h4 className="text-xs font-semibold text-[#E6EDF3]">
              Editorial Notes ({auditorReport.surgical_directives.length})
            </h4>
          </div>
          {activePass.sectionDiffsCount > 0 && (
            <button
              type="button"
              onClick={() => onJumpToDiff()}
              className="text-xs font-mono text-[#58A6FF] hover:underline whitespace-nowrap shrink-0"
            >
              See Changes Made →
            </button>
          )}
        </div>

        {auditorReport.surgical_directives.length === 0 ? (
          <div className="p-3 bg-[#0D1117] border border-[#30363D] rounded text-xs text-[#3FB950] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              Your script meets the target quality standard across all sections.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {auditorReport.surgical_directives.map((dir, i) => (
              <div
                key={`${dir.section_id}-${i}`}
                className="p-3 bg-[#0D1117] border border-[#30363D] rounded space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2 font-mono">
                  <span className="font-bold text-[#58A6FF]">
                    Section [{dir.section_id}]
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToDiff(dir.section_id)}
                    className="text-[#8B949E] hover:text-[#E6EDF3] underline whitespace-nowrap shrink-0"
                  >
                    View Changes →
                  </button>
                </div>
                <div className="text-[#D29922]">{dir.flaw}</div>
                <div className="text-[#E6EDF3]/90">{dir.editorial_order}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
