import React from "react";
import { X, BookOpen } from "lucide-react";
import { EDITORIAL_CHARTER, RUBRIC_100_POINT } from "../utils/prompts";
import { FORBIDDEN_DOMESTIC_PHRASES } from "../utils/scriptEngine";

interface CharterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CharterModal: React.FC<CharterModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="charter-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="bg-[#161B22] border border-[#30363D] rounded-md w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#30363D] flex items-center justify-between bg-[#0D1117]">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#58A6FF]" />
            <h2
              id="charter-modal-title"
              className="text-sm font-semibold text-[#E6EDF3]"
            >
              THE PAPER TRAIL: Permanent Editorial Standards &amp; Rubric
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Editorial Guide"
            className="p-1 rounded text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#161B22]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs text-[#E6EDF3]">
          <div className="bg-[#0D1117] border border-[#30363D] rounded p-4 space-y-2">
            <div className="text-[#58A6FF] font-semibold">
              Storytelling Charter (*Serial* &amp; *Pretend* Standard)
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[#E6EDF3]/90 leading-relaxed">
              {EDITORIAL_CHARTER}
            </pre>
          </div>

          <div className="bg-[#0D1117] border border-[#30363D] rounded p-4 space-y-2">
            <div className="text-[#58A6FF] font-semibold">
              100-Point Script Quality Criteria
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[#E6EDF3]/90 leading-relaxed">
              {RUBRIC_100_POINT}
            </pre>
          </div>

          <div className="bg-[#0D1117] border border-[#30363D] rounded p-4 space-y-2">
            <div className="text-[#58A6FF] font-semibold">
              Protected Privacy Boundaries
            </div>
            <p className="text-[#8B949E] leading-relaxed">
              The editor automatically checks that private off-limits phrases
              never appear in your script:
            </p>
            <div className="flex flex-wrap gap-2 pt-1 font-mono">
              {FORBIDDEN_DOMESTIC_PHRASES.map((p) => (
                <span
                  key={p}
                  className="px-2 py-1 rounded bg-[#161B22] border border-[#30363D] text-[#F85149]"
                >
                  "{p}"
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
