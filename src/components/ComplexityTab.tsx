import React, { useState } from "react";
import {
  Users,
  HeartHandshake,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Wand2,
  Copy,
  Check,
  Search,
  BookOpen,
  ArrowRight,
  Flame,
  Activity,
  MessageSquare,
} from "lucide-react";
import type {
  HumanComplexityReport,
  CharacterProfile,
  CharacterId,
  NarratorBlockPatch,
} from "../utils/scriptEngine";

interface ComplexityTabProps {
  complexityReport: HumanComplexityReport;
  onApplySurgicalPatches: (
    patches: NarratorBlockPatch[],
    description: string
  ) => number;
  onAskCopilotPrompt?: (prompt: string) => void;
  onJumpToSection?: (sectionId: string) => void;
}

export const ComplexityTab: React.FC<ComplexityTabProps> = ({
  complexityReport,
  onApplySurgicalPatches,
  onAskCopilotPrompt,
  onJumpToSection,
}) => {
  const [selectedCharacterId, setSelectedCharacterId] =
    useState<CharacterId>("sav");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>("");

  const activeCharacter: CharacterProfile =
    complexityReport.characters.find(
      (c) => c.character_id === selectedCharacterId
    ) || complexityReport.characters[0];

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSpliceSavNuance = () => {
    const audit = complexityReport.savNuanceAudit;
    if (
      !audit.target_section_id ||
      !audit.target_narrator_block_id ||
      !audit.suggested_surgical_enhancement
    ) {
      return;
    }
    const count = onApplySurgicalPatches(
      [
        {
          section_id: audit.target_section_id,
          block_id: audit.target_narrator_block_id,
          updated_narrator_markdown: audit.suggested_surgical_enhancement,
        },
      ],
      "Spliced Sav Agency & Complexity Enhancement (Option D)"
    );
    if (count > 0) {
      setAppliedIds((prev) => new Set(prev).add("SAV_NUANCE_SURGICAL"));
    }
  };

  const filteredArcMoments = activeCharacter.arc_moments.filter((moment) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const haystack = `${moment.section_id} ${moment.section_title} ${moment.emotional_state} ${moment.relationship_status} ${moment.narrator_treatment} ${moment.evidence_quote_excerpt}`.toLowerCase();
    return haystack.includes(term);
  });

  return (
    <div
      data-testid="complexity-tab"
      className="bg-[#161B22] border border-[#30363D] rounded-md p-5 space-y-6"
    >
      {/* Header & Benchmark Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#58A6FF]">
              <HeartHandshake className="w-4 h-4 text-[#58A6FF]" />
              RELATIONSHIP &amp; HUMAN COMPLEXITY TRACKER
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#238636]/20 border border-[#238636]/50 text-[#3FB950] font-semibold">
              Option D • Serial/Pretend Benchmark
            </span>
          </div>
          <h2 className="text-xl font-bold text-[#E6EDF3] tracking-tight">
            Character Arcs, Agency &amp; Anti-Flattening Auditor
          </h2>
          <p className="text-xs text-[#8B949E] max-w-4xl leading-relaxed">
            The Paper Trail is a story about real people, trust, changing alliances, and messy
            human realities — not a static courtroom prosecution. The engine monitors all 6
            participants across the 13 chapters to safeguard against cartoon villainy and ensure
            conflicted figures like Sav retain full personal agency.
          </p>
        </div>

        {/* Quick Metrics Cards */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Complexity
            </div>
            <div className="text-lg font-bold font-mono text-[#3FB950]">
              {complexityReport.overallComplexityScore}%
            </div>
          </div>
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Sav Agency
            </div>
            <div className="text-lg font-bold font-mono text-[#58A6FF]">
              {complexityReport.savNuanceAudit.sav_in_middle_score}%
            </div>
          </div>
          <div className="px-3.5 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[90px]">
            <div className="text-[10px] font-mono text-[#8B949E] uppercase">
              Archetype Risk
            </div>
            <div
              className={`text-lg font-bold font-mono ${
                complexityReport.archetypeWarningsCount === 0
                  ? "text-[#3FB950]"
                  : "text-[#D29922]"
              }`}
            >
              {complexityReport.archetypeWarningsCount === 0
                ? "0 Flags"
                : `${complexityReport.archetypeWarningsCount} Warning`}
            </div>
          </div>
        </div>
      </div>

      {/* Sav in the Middle Nuance Scanner Card (Act II Fulcrum) */}
      <div className="p-4 rounded-lg bg-[#0D1117] border border-[#58A6FF]/40 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#30363D]">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-[#58A6FF]/20 text-[#58A6FF]">
              <Sparkles className="w-4 h-4" />
            </span>
            <span className="text-xs font-mono font-bold text-[#58A6FF] tracking-wide">
              &ldquo;SAV IN THE MIDDLE&rdquo; NUANCE SCANNER — ACT II EMOTIONAL FULCRUM
            </span>
          </div>
          <span
            className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded border ${
              !complexityReport.savNuanceAudit.bystander_trap_detected
                ? "bg-[#238636]/20 border-[#238636]/60 text-[#3FB950]"
                : "bg-[#D29922]/20 border-[#D29922]/60 text-[#D29922]"
            }`}
          >
            {!complexityReport.savNuanceAudit.bystander_trap_detected
              ? "✓ Active Personal Agency (Fulcrum Intact)"
              : "⚠ Bystander Trap Detected"}
          </span>
        </div>

        <p className="text-xs text-[#E6EDF3] leading-relaxed">
          Sav is the emotional bridge of the narrative: someone who genuinely cared for both Angela
          and Logan. For top-tier audio drama, narration must credit Sav with her own decisions,
          acknowledged mistakes (e.g. admitting she &ldquo;gassed Angela up&rdquo;), and active lines
          drawn on children — rather than reducing her to a passive pawn caught in the crossfire.
        </p>

        {/* 5-Point Agency Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-1">
          <div
            className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
              complexityReport.savNuanceAudit.agency_moments_acknowledged.gassed_angela_up
                ? "bg-[#161B22] border-[#238636]/50 text-[#E6EDF3]"
                : "bg-[#161B22]/50 border-[#30363D] text-[#8B949E]"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {complexityReport.savNuanceAudit.agency_moments_acknowledged.gassed_angela_up ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950]" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-[#D29922]" />
              )}
              <span>1. &ldquo;Gassed Angela Up&rdquo;</span>
            </div>
            <p className="text-[10px] text-[#8B949E] leading-tight">
              Acknowledges encouraging Angela when angry at Logan.
            </p>
          </div>

          <div
            className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
              complexityReport.savNuanceAudit.agency_moments_acknowledged.not_a_honeypot
                ? "bg-[#161B22] border-[#238636]/50 text-[#E6EDF3]"
                : "bg-[#161B22]/50 border-[#30363D] text-[#8B949E]"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {complexityReport.savNuanceAudit.agency_moments_acknowledged.not_a_honeypot ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950]" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-[#D29922]" />
              )}
              <span>2. Not a &ldquo;Honeypot&rdquo;</span>
            </div>
            <p className="text-[10px] text-[#8B949E] leading-tight">
              Affirms organic arrival from TikTok; rejects pawn label.
            </p>
          </div>

          <div
            className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
              complexityReport.savNuanceAudit.agency_moments_acknowledged.demanded_receipt_deletion
                ? "bg-[#161B22] border-[#238636]/50 text-[#E6EDF3]"
                : "bg-[#161B22]/50 border-[#30363D] text-[#8B949E]"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {complexityReport.savNuanceAudit.agency_moments_acknowledged.demanded_receipt_deletion ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950]" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-[#D29922]" />
              )}
              <span>3. Demanded Deletion</span>
            </div>
            <p className="text-[10px] text-[#8B949E] leading-tight">
              Actively confronted Angela to take down leaked screenshots.
            </p>
          </div>

          <div
            className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
              complexityReport.savNuanceAudit.agency_moments_acknowledged.corrected_photo_allegation
                ? "bg-[#161B22] border-[#238636]/50 text-[#E6EDF3]"
                : "bg-[#161B22]/50 border-[#30363D] text-[#8B949E]"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {complexityReport.savNuanceAudit.agency_moments_acknowledged.corrected_photo_allegation ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950]" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-[#D29922]" />
              )}
              <span>4. Corrected Record</span>
            </div>
            <p className="text-[10px] text-[#8B949E] leading-tight">
              Admitted asking for the image herself, refuting wrongful claims.
            </p>
          </div>

          <div
            className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
              complexityReport.savNuanceAudit.agency_moments_acknowledged.drew_line_on_children
                ? "bg-[#161B22] border-[#238636]/50 text-[#E6EDF3]"
                : "bg-[#161B22]/50 border-[#30363D] text-[#8B949E]"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {complexityReport.savNuanceAudit.agency_moments_acknowledged.drew_line_on_children ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950]" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-[#D29922]" />
              )}
              <span>5. Line on Children</span>
            </div>
            <p className="text-[10px] text-[#8B949E] leading-tight">
              Firmly walked away when retaliation targeted families.
            </p>
          </div>
        </div>

        {/* Verdict & Optional Surgical Patch */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded bg-[#161B22] border border-[#30363D]">
          <div className="space-y-1 text-xs">
            <span className="font-mono text-[#8B949E] text-[10px] uppercase font-bold">
              Editorial Diagnosis:
            </span>
            <p className="text-[#E6EDF3] leading-relaxed">
              {complexityReport.savNuanceAudit.editorial_verdict}
            </p>
          </div>

          {complexityReport.savNuanceAudit.suggested_surgical_enhancement && (
            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSpliceSavNuance}
                disabled={appliedIds.has("SAV_NUANCE_SURGICAL")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors ${
                  appliedIds.has("SAV_NUANCE_SURGICAL")
                    ? "bg-[#238636]/30 text-[#3FB950] border border-[#238636]/50 cursor-default"
                    : "bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-[#0D1117]"
                }`}
              >
                {appliedIds.has("SAV_NUANCE_SURGICAL") ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Spliced into CH_04</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Audition &amp; Splice Sav Nuance</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Angela Archetype Safeguard Banner */}
      <div className="p-4 rounded-lg bg-[#0D1117] border border-[#D29922]/40 space-y-3">
        <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#D29922]">
          <ShieldAlert className="w-4 h-4 text-[#D29922]" />
          <span>ANGELA ARCHETYPE SAFEGUARD — ANTI-CARTOON VILLAINY</span>
        </div>
        <p className="text-xs text-[#8B949E] leading-relaxed">
          Serial and Pretend avoid creating cartoon antagonists. The engine audits Angela&apos;s
          treatment to ensure her early genuine defense of community members (Chapter 1), the
          intense provocation surrounding personal loss, and her own expressed fear of being
          cornered are clearly represented before the breakdown.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs font-mono pt-1">
          <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D] space-y-1">
            <span className="text-[#3FB950] text-[10px] font-bold">✓ CHAPTER 1 ANCHOR</span>
            <p className="text-[#E6EDF3] text-[11px]">
              Mutual Defense: Logan describes Angela as a fierce advocate who previously defended him
              against online harassment.
            </p>
          </div>
          <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D] space-y-1">
            <span className="text-[#3FB950] text-[10px] font-bold">✓ CHAPTER 2 ANCHOR</span>
            <p className="text-[#E6EDF3] text-[11px]">
              Ordinary Precaution: Archiving notes for a &ldquo;rainy day&rdquo; is framed as a
              natural protective reflex in contentious online spaces.
            </p>
          </div>
          <div className="p-2.5 rounded bg-[#161B22] border border-[#30363D] space-y-1">
            <span className="text-[#3FB950] text-[10px] font-bold">✓ EPILOGUE ANCHOR</span>
            <p className="text-[#E6EDF3] text-[11px]">
              Human Fallibility: Acknowledges that both sides made mistakes in public, avoiding
              unilateral moral condemnation.
            </p>
          </div>
        </div>
      </div>

      {/* Character Selector Pills */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold text-[#8B949E] uppercase">
            Participant Arc Audit (6 Tracked Figures):
          </span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8B949E] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search arc moments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1 bg-[#0D1117] border border-[#30363D] rounded text-xs text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:border-[#58A6FF]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {complexityReport.characters.map((char) => {
            const isSelected = char.character_id === selectedCharacterId;
            return (
              <button
                key={char.character_id}
                type="button"
                onClick={() => setSelectedCharacterId(char.character_id)}
                className={`p-3 rounded border text-left transition-all ${
                  isSelected
                    ? "bg-[#0D1117] border-[#58A6FF] shadow-sm"
                    : "bg-[#161B22] border-[#30363D] hover:border-[#8B949E]"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`font-mono text-xs font-bold ${
                      isSelected ? "text-[#58A6FF]" : "text-[#E6EDF3]"
                    }`}
                  >
                    {char.name}
                  </span>
                  <span className="text-[10px] font-mono text-[#3FB950] font-bold">
                    {char.complexity_score}%
                  </span>
                </div>
                <div className="text-[10px] text-[#8B949E] truncate">
                  {char.role_in_story}
                </div>
                {char.archetype_risk_flag && (
                  <span className="inline-block mt-1 text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#D29922]/20 border border-[#D29922]/50 text-[#D29922]">
                    ⚠ Archetype Risk
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Character Deep-Dive Profile */}
      <div className="p-4 rounded-lg bg-[#0D1117] border border-[#30363D] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#30363D]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[#E6EDF3]">
                {activeCharacter.name}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#161B22] border border-[#30363D] text-[#58A6FF]">
                {activeCharacter.role_in_story}
              </span>
            </div>
            <div className="text-xs text-[#8B949E] mt-1">
              Tracking psychological and emotional progression across {activeCharacter.arc_moments.length} key chapters.
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onAskCopilotPrompt && (
              <button
                type="button"
                onClick={() =>
                  onAskCopilotPrompt(
                    `Audit the character treatment of ${activeCharacter.name} across all chapters. Are there any scenes where they sound flattened or one-dimensional? Suggest Option D refinements.`
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161B22] hover:bg-[#30363D] border border-[#30363D] text-xs font-mono text-[#E6EDF3] transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#58A6FF]" />
                <span>Ask Co-Pilot</span>
              </button>
            )}
          </div>
        </div>

        {/* Humanizing Anchors List */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono font-bold text-[#8B949E] uppercase">
            Key Humanizing Anchors in Draft:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {activeCharacter.humanizing_anchors.map((anchor, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded-full bg-[#161B22] border border-[#3FB950]/40 text-[#3FB950] text-[11px] font-mono flex items-center gap-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                {anchor}
              </span>
            ))}
          </div>
        </div>

        {/* Arc Moments Timeline */}
        <div className="space-y-3 pt-2">
          <span className="text-[10px] font-mono font-bold text-[#8B949E] uppercase">
            Chapter-by-Chapter Emotional &amp; Relational Progression:
          </span>

          <div className="space-y-3">
            {filteredArcMoments.map((moment, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded bg-[#161B22] border border-[#30363D] space-y-3 hover:border-[#8B949E] transition-colors"
              >
                {/* Moment Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#58A6FF]/40 text-[#58A6FF] font-bold">
                      {moment.section_id}
                    </span>
                    <span className="font-bold text-[#E6EDF3]">
                      {moment.section_title}
                    </span>
                    <span className="text-[10px] text-[#8B949E]">
                      ({moment.act_id})
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

                {/* State & Relationship Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs font-mono">
                  <div className="p-2 rounded bg-[#0D1117] border-l-2 border-[#58A6FF] space-y-0.5">
                    <span className="text-[10px] text-[#58A6FF] uppercase font-bold">
                      Emotional &amp; Psychological State:
                    </span>
                    <p className="text-[#E6EDF3]">{moment.emotional_state}</p>
                  </div>

                  <div className="p-2 rounded bg-[#0D1117] border-l-2 border-[#3FB950] space-y-0.5">
                    <span className="text-[10px] text-[#3FB950] uppercase font-bold">
                      Relationship Dynamic:
                    </span>
                    <p className="text-[#E6EDF3]">{moment.relationship_status}</p>
                  </div>
                </div>

                {/* Primary Evidence Tape Quote */}
                <div className="p-2.5 rounded bg-[#0D1117] border border-[#30363D] space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#8B949E]">
                    <span className="flex items-center gap-1 text-[#D29922]">
                      <BookOpen className="w-3 h-3" />
                      {moment.primary_evidence_cue}
                    </span>
                    <span>Archival Grounding</span>
                  </div>
                  <div className="text-xs text-[#E6EDF3] italic font-serif leading-relaxed border-l-2 border-[#D29922] pl-2.5">
                    &ldquo;{moment.evidence_quote_excerpt}&rdquo;
                  </div>
                </div>

                {/* Narrator Treatment & Editorial Recommendation */}
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

                {/* Optional Jump to Section Action */}
                {onJumpToSection && (
                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => onJumpToSection(moment.section_id)}
                      className="flex items-center gap-1 text-xs font-mono text-[#58A6FF] hover:underline"
                    >
                      <span>Jump to {moment.section_id} in Master Script</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
