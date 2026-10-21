import React, { useEffect, useMemo, useState } from "react";
import {
  Network,
  Ear,
  DoorOpen,
  Workflow,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
  XCircle,
  ArrowRight,
  Copy,
  Check,
  Info,
} from "lucide-react";
import { PAPER_TRAIL_KNOWLEDGE } from "../utils/narrative/knowledgeBase";
import { buildStoryModel, type SceneNode } from "../utils/narrative/storyModel";
import { simulateListenerTimeline, type ListenerTimeline } from "../utils/narrative/listenerModel";
import { buildOpeningsLab, type GatewayResult } from "../utils/narrative/openingsLab";
import { manuscriptVersionId } from "../utils/narrative/hash";
import type { NarrativeReport } from "../utils/narrative/narrativeReport";
import type { OrchestratorResult } from "../utils/narrative/orchestrator";
import type { ManuscriptCandidate } from "../utils/narrative/structuralOps";
import { safeFetchJson, sanitizeApiErrorMessage } from "../utils/safeFetch";

type Panel = "architecture" | "listener" | "openings" | "editorial";

interface ProviderInfo {
  display_name: string;
  model?: string;
  kind: string;
  available: boolean;
  reason: string;
}

interface NarrativeIntelligenceTabProps {
  manuscript: string;
  pinnedBlockIds: Set<string>;
  /** Applies a staged manuscript after a version check; App saves a rollback checkpoint first. */
  onApplyStagedManuscript: (markdown: string, label: string, baseVersionId: string) => boolean;
  onJumpToSection?: (sectionId: string) => void;
}

const ROLE_STYLE: Record<SceneNode["role"], { label: string; cls: string }> = {
  crucial_turn: { label: "Crucial Story Turn", cls: "bg-[#1F6FEB]/15 border-[#1F6FEB]/50 text-[#58A6FF]" },
  human_texture: { label: "Supporting Human Texture", cls: "bg-[#238636]/15 border-[#238636]/50 text-[#3FB950]" },
  pacing_drag: { label: "Pacing Drag / Redundant", cls: "bg-[#D29922]/15 border-[#D29922]/50 text-[#D29922]" },
};

const ACTION_STYLE: Record<string, string> = {
  keep: "text-[#8B949E]",
  move: "text-[#A371F7]",
  merge: "text-[#D29922]",
  trim: "text-[#F0883E]",
};

const Badge: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>
);

const SourceNote: React.FC<{ kind: string; text: string }> = ({ kind, text }) => (
  <div className="flex items-start gap-1.5 text-[11px] text-[#8B949E]">
    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
    <span>
      <span className="font-mono text-[#C9D1D9]">{kind}</span> {text}
    </span>
  </div>
);

export const NarrativeIntelligenceTab: React.FC<NarrativeIntelligenceTabProps> = ({
  manuscript,
  pinnedBlockIds,
  onApplyStagedManuscript,
  onJumpToSection,
}) => {
  const [panel, setPanel] = useState<Panel>("architecture");
  const versionId = useMemo(() => manuscriptVersionId(manuscript), [manuscript]);
  const model = useMemo(() => buildStoryModel(manuscript, PAPER_TRAIL_KNOWLEDGE), [manuscript]);
  const deterministicTimeline = useMemo(() => simulateListenerTimeline(manuscript, PAPER_TRAIL_KNOWLEDGE, model), [manuscript, model]);
  const lab = useMemo(
    () => (panel === "openings" ? buildOpeningsLab(manuscript, PAPER_TRAIL_KNOWLEDGE, pinnedBlockIds) : null),
    [panel, manuscript, pinnedBlockIds]
  );

  const [timeline, setTimeline] = useState<ListenerTimeline | null>(null);
  const [criticReport, setCriticReport] = useState<NarrativeReport | null>(null);
  const [providers, setProviders] = useState<{ writer: ProviderInfo; critic: ProviderInfo; codex_diagnostics?: { checked: Array<{ bin: string; usable: boolean; note: string }> } | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<OrchestratorResult | null>(null);
  const [iterations, setIterations] = useState(2);
  const [narrThreshold, setNarrThreshold] = useState(85);
  const [craftThreshold, setCraftThreshold] = useState(85);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Persist and fetch any stored analysis for this version (critic report, AI listener predictions).
  useEffect(() => {
    let cancelled = false;
    setTimeline(null);
    setCriticReport(null);
    const t = setTimeout(() => {
      safeFetchJson<{ timeline: ListenerTimeline; critic_report: NarrativeReport | null }>("/api/narrative/analyze", { method: "POST", body: JSON.stringify({ manuscript }) }, { retries: 0 })
        .then((r) => {
          if (cancelled) return;
          if (r.timeline?.manuscript_version_id === versionId) setTimeline(r.timeline);
          if (r.critic_report?.manuscript_version_id === versionId) setCriticReport(r.critic_report);
        })
        .catch(() => {
          // Server persistence is optional for the deterministic panels.
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [manuscript, versionId]);

  useEffect(() => {
    if (panel !== "editorial" || providers) return;
    safeFetchJson<typeof providers>("/api/narrative/providers", { method: "GET" }, { retries: 0 })
      .then(setProviders)
      .catch((e) => setError(sanitizeApiErrorMessage(e, "Could not read provider status.")));
  }, [panel, providers]);

  const activeTimeline = timeline && timeline.manuscript_version_id === versionId ? timeline : deterministicTimeline;

  const call = async <T,>(label: string, url: string, body: unknown): Promise<T | null> => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await safeFetchJson<T>(url, { method: "POST", body: JSON.stringify(body) }, { retries: 0 });
    } catch (e) {
      setError(sanitizeApiErrorMessage(e, `${label} failed.`));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runReview = async () => {
    const r = await call<{ report: NarrativeReport; cached: boolean }>("Gemini story review", "/api/narrative/review", { manuscript });
    if (r) {
      setCriticReport(r.report);
      setNotice(r.cached ? "Showing the stored review for this exact version." : "Independent story review complete.");
    }
  };

  const runListener = async () => {
    const r = await call<{ timeline: ListenerTimeline; predicted_scenes: string[]; remaining: number; blocked: Array<{ scene_id: string }> }>(
      "Cold listener simulation", "/api/narrative/listener", { manuscript, max_calls: 3 }
    );
    if (r) {
      setTimeline(r.timeline);
      setNotice(`Predicted ${r.predicted_scenes.length} scene(s): ${r.predicted_scenes.join(", ") || "none"}. ${r.remaining} remaining.${r.blocked.length ? ` Blocked for leakage: ${r.blocked.map((b) => b.scene_id).join(", ")}.` : ""}`);
    }
  };

  const runLoop = async () => {
    const r = await call<OrchestratorResult>("Editorial loop", "/api/narrative/run", {
      manuscript,
      expected_base_version_id: versionId,
      pinnedBlockIds: Array.from(pinnedBlockIds),
      config: { max_iterations: iterations, narrative_threshold: narrThreshold, craft_threshold: craftThreshold },
    });
    if (r) setRun(r);
  };

  const applyCandidate = async (candidate: ManuscriptCandidate) => {
    if (candidate.origin === "orchestrator") {
      const r = await call<{ ok: boolean; markdown: string }>("Accept candidate", `/api/narrative/candidates/${candidate.candidate_id}/decision`, { decision: "accept", current_manuscript: manuscript });
      if (!r?.ok) return;
    } else {
      void call("Stage candidate", "/api/narrative/candidates", { candidate });
    }
    if (onApplyStagedManuscript(candidate.markdown, candidate.label, candidate.base_version_id)) {
      setNotice(`Applied "${candidate.label}". A checkpoint of the previous version was saved for rollback.`);
    } else {
      setError("The manuscript changed since this candidate was built. Rebuild it from the current version.");
    }
  };

  const rejectCandidate = async (candidate: ManuscriptCandidate) => {
    await call("Reject candidate", `/api/narrative/candidates/${candidate.candidate_id}/decision`, { decision: "reject" });
    setRun((prev) => (prev ? { ...prev, candidate: prev.candidate ? { ...prev.candidate, status: "rejected" } : null } : prev));
  };

  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const sceneTitle = (id: string) => model.scenes.find((s) => s.scene_id === id)?.title || id;
  const keyDeps = model.dependencies.filter((d) => d.kind !== "character_thread");
  const counts = {
    crucial: model.scenes.filter((s) => s.role === "crucial_turn").length,
    texture: model.scenes.filter((s) => s.role === "human_texture").length,
    drag: model.scenes.filter((s) => s.role === "pacing_drag").length,
    flags: activeTimeline.states.reduce((n, s) => n + s.confusion.filter((c) => !c.resolved_within_scene).length, 0),
  };

  const panels: Array<{ id: Panel; label: string; icon: React.ReactNode }> = [
    { id: "architecture", label: "Story Architecture", icon: <Network className="w-3.5 h-3.5" /> },
    { id: "listener", label: "Fresh Listener", icon: <Ear className="w-3.5 h-3.5" /> },
    { id: "openings", label: "Openings Lab", icon: <DoorOpen className="w-3.5 h-3.5" /> },
    { id: "editorial", label: "Editorial Loop", icon: <Workflow className="w-3.5 h-3.5" /> },
  ];

  return (
    <div data-testid="narrative-intelligence-tab" className="bg-[#161B22] border border-[#30363D] rounded-md p-5 space-y-5">
      <div className="flex flex-col gap-3 pb-4 border-b border-[#30363D]">
        <div className="space-y-1">
          <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#58A6FF]">
            <Network className="w-4 h-4" /> NARRATIVE INTELLIGENCE ENGINE
          </span>
          <h2 className="text-xl font-bold text-[#E6EDF3] tracking-tight">The Documentary as One Continuous Story</h2>
          <p className="text-xs text-[#8B949E] max-w-4xl leading-relaxed">
            Structure, first-time listener comprehension, and alternate openings, derived from the manuscript itself.
            Deterministic signals are shown immediately; Gemini (critic) and ChatGPT (writer) judgments are labeled as such.
            Nothing here changes the master script until you apply a staged version.
          </p>
          <div className="text-[10px] font-mono text-[#6E7681]">Version {versionId}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["Story turns", counts.crucial, "text-[#58A6FF]"],
            ["Texture", counts.texture, "text-[#3FB950]"],
            ["Drag", counts.drag, "text-[#D29922]"],
            ["Listener flags", counts.flags, "text-[#F0883E]"],
          ].map(([label, value, cls]) => (
            <div key={String(label)} className="px-3 py-2 rounded bg-[#0D1117] border border-[#30363D] text-center min-w-[78px]">
              <div className="text-[10px] font-mono text-[#8B949E] uppercase">{label}</div>
              <div className={`text-lg font-bold font-mono ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist">
        {panels.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={panel === p.id}
            onClick={() => setPanel(p.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
              panel === p.id ? "bg-[#1F6FEB] border-[#1F6FEB] text-white" : "bg-[#0D1117] border-[#30363D] text-[#C9D1D9] hover:border-[#58A6FF]"
            }`}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-xs text-[#58A6FF]">
          <Loader2 className="w-4 h-4 animate-spin" /> {busy} in progress… (model calls can take a few minutes)
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-xs text-[#F85149] bg-[#F85149]/10 border border-[#F85149]/40 rounded p-2.5">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 text-xs text-[#3FB950] bg-[#238636]/10 border border-[#238636]/40 rounded p-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {notice}
        </div>
      )}

      {/* ===================== ARCHITECTURE ===================== */}
      {panel === "architecture" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SourceNote kind="Deterministic signals:" text="roles and actions come from textual evidence (new people, dates, escalation, callbacks, reprised tape). Use the Gemini review for editorial judgment." />
            <button onClick={runReview} disabled={Boolean(busy)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2EA043] disabled:opacity-50 text-white">
              <Play className="w-3.5 h-3.5" /> {criticReport ? "Re-run" : "Run"} Gemini story review
            </button>
          </div>

          {model.bottlenecks.map((b) => (
            <div key={b.scene_ids.join("-")} className="flex items-start gap-2 text-xs text-[#D29922] bg-[#D29922]/10 border border-[#D29922]/40 rounded p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span><b>Pacing bottleneck:</b> {b.reason}</span>
            </div>
          ))}

          <div className="space-y-1.5">
            {model.scenes.map((s) => {
              const sem = model.semantic[s.content_hash];
              const critic = criticReport?.scene_findings.filter((f) => f.scene_id === s.scene_id) || [];
              return (
                <div key={s.scene_id} className="bg-[#0D1117] border border-[#30363D] rounded p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-mono text-[#6E7681] w-5">{s.index + 1}</span>
                    <button onClick={() => onJumpToSection?.(s.scene_id)} className="text-xs font-mono font-bold text-[#58A6FF] hover:underline">{s.scene_id}</button>
                    <span className="text-xs font-semibold text-[#E6EDF3]">{s.title}</span>
                    <Badge cls={ROLE_STYLE[s.role].cls}>{ROLE_STYLE[s.role].label}</Badge>
                    <span className={`text-[11px] font-mono font-bold uppercase ${ACTION_STYLE[s.macro_action]}`}>{s.macro_action}</span>
                    <span className="text-[10px] font-mono text-[#6E7681] ml-auto">
                      {s.tape_unit_ids.length} tape · {s.signals.reading_units} written · {s.signals.narration_words}w narration
                    </span>
                  </div>
                  <div className="mt-1.5 pl-7 text-[11px] text-[#8B949E] leading-relaxed">
                    {s.role_reasons.join(" ")} {s.macro_action !== "keep" || s.signals.has_flashback ? <span className="text-[#C9D1D9]">{s.macro_reason}</span> : null}
                  </div>
                  {(critic.length > 0 || sem) && (
                    <div className="mt-2 pl-7 space-y-1">
                      {critic.map((f) => (
                        <div key={f.id} className="text-[11px] text-[#C9D1D9]">
                          <span className="font-mono text-[#A371F7]">Gemini ({f.basis}, {f.priority}):</span> {f.finding}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {criticReport && (
            <div className="bg-[#0D1117] border border-[#A371F7]/40 rounded p-3 space-y-2">
              <div className="text-xs font-mono font-bold text-[#A371F7]">
                INDEPENDENT CRITIC: {criticReport.source.provider_id} ({criticReport.source.model}, {criticReport.source.kind})
              </div>
              <p className="text-xs text-[#C9D1D9]">{criticReport.global_assessment.summary}</p>
              <div className="text-xs text-[#8B949E]">Central question: <span className="text-[#E6EDF3]">{criticReport.global_assessment.central_question}</span></div>
              <div className="flex gap-4 text-xs font-mono">
                <span>Narrative: <b className="text-[#58A6FF]">{criticReport.global_assessment.narrative_effectiveness.score ?? "n/a"}</b></span>
                <span>Craft: <b className="text-[#58A6FF]">{criticReport.global_assessment.craftsmanship.score ?? "n/a"}</b></span>
                <span className="text-[#6E7681]">Decision support, not an objective measure.</span>
              </div>
              {criticReport.proposed_operations.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono text-[#8B949E]">PROPOSED STRUCTURAL OPERATIONS</div>
                  {criticReport.proposed_operations.map((p) => (
                    <div key={p.id} className="text-[11px] text-[#C9D1D9]">
                      <span className="font-mono text-[#D29922]">[{p.priority}] {p.operation.op}</span> {p.rationale} <span className="text-[#8B949E]">Benefit: {p.expected_benefit} · confidence {Math.round(p.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <details className="bg-[#0D1117] border border-[#30363D] rounded p-3">
            <summary className="text-xs font-mono font-bold text-[#C9D1D9] cursor-pointer">NARRATIVE DEPENDENCIES ({keyDeps.length})</summary>
            <div className="mt-2 space-y-1">
              {keyDeps.map((d) => (
                <div key={d.id} className="text-[11px] text-[#8B949E]">
                  <span className="font-mono text-[#58A6FF]">{d.kind}</span> {d.from_scene_id} <ArrowRight className="inline w-3 h-3" /> {d.to_scene_id}: <span className="text-[#C9D1D9]">{d.evidence.slice(0, 140)}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* ===================== FRESH LISTENER ===================== */}
      {panel === "listener" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SourceNote kind="Presented information:" text="what narration and tape actually tell a listener with no prior knowledge, in order. Each scene sees only what came before it. AI predictions, when present, are hypotheses, not audience data." />
            <button onClick={runListener} disabled={Boolean(busy)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2EA043] disabled:opacity-50 text-white">
              <Ear className="w-3.5 h-3.5" /> Simulate next 3 scenes with Gemini
            </button>
          </div>
          {activeTimeline.states.map((st) => {
            const open = st.confusion.filter((c) => !c.resolved_within_scene);
            return (
              <div key={st.scene_id} className="bg-[#0D1117] border border-[#30363D] rounded p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => onJumpToSection?.(st.scene_id)} className="text-xs font-mono font-bold text-[#58A6FF] hover:underline">{st.scene_id}</button>
                  <span className="text-xs text-[#E6EDF3] font-semibold">{sceneTitle(st.scene_id)}</span>
                  <span className="text-[10px] font-mono text-[#8B949E]">voices identified {st.voices_identified}/{st.voices_heard}</span>
                  <span className={`text-[10px] font-mono ${st.advances_understanding ? "text-[#3FB950]" : "text-[#6E7681]"}`}>
                    {st.advances_understanding ? `+${st.new_information_count} presented facts` : "no new presented facts (may still carry emotional weight)"}
                  </span>
                </div>
                {st.primary_question && (
                  <div className="text-xs text-[#E6EDF3]">
                    <span className="font-mono text-[11px] text-[#A371F7]">Listener's question ({st.primary_question.basis.replace(/_/g, " ")}):</span> {st.primary_question.text}
                  </div>
                )}
                {st.learned.length > 0 && <div className="text-[11px] text-[#8B949E]"><span className="font-mono text-[#3FB950]">Learned:</span> {st.learned.join(" · ")}</div>}
                {open.length > 0 && (
                  <div className="space-y-1">
                    {open.map((f) => {
                      const later = activeTimeline.editorial_resolutions[f.id];
                      return (
                        <div key={f.id} className="text-[11px] text-[#F0883E]">
                          <AlertTriangle className="inline w-3 h-3 mr-1" />
                          {f.kind === "unidentified_voice" ? `Unnamed voice (${f.term})` : f.kind === "unexplained_name" ? `Unexplained name "${f.term}"` : f.kind === "unexplained_term" ? `Insider term "${f.term}" (${f.heard_in})` : f.excerpt}
                          <span className="text-[#6E7681]"> · editor view: {later ? `resolved in ${later}` : "never resolved"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {st.predicted && (
                  <div className="border-t border-[#30363D] pt-2 space-y-0.5 text-[11px] text-[#C9D1D9]">
                    <div className="font-mono text-[#A371F7]">AI PREDICTION ({st.predicted.provider_id}, {st.predicted.model}, {st.predicted.kind}). {st.predicted.disclaimer}</div>
                    <div><b>Infers:</b> {st.predicted.inferred.join("; ")}</div>
                    <div><b>Curious about:</b> {st.predicted.curiosity}</div>
                    <div><b>Investment:</b> {st.predicted.emotional_investment} · <b>Fatigue risk:</b> {st.predicted.fatigue_risk}</div>
                    <div><b>Keeps listening because:</b> {st.predicted.motivation_to_continue}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===================== OPENINGS LAB ===================== */}
      {panel === "openings" && lab && (
        <div className="space-y-4">
          <SourceNote kind="Hypotheses, not verdicts:" text={lab.comparison_note} />
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {lab.gateways.map((g: GatewayResult) => (
              <div key={g.gateway.id} className="bg-[#0D1117] border border-[#30363D] rounded p-3 space-y-2 flex flex-col">
                <div className="text-sm font-bold text-[#E6EDF3]">{g.gateway.label}</div>
                <p className="text-[11px] text-[#8B949E] italic">{g.gateway.hypothesis}</p>
                {!g.available ? (
                  <div className="text-[11px] text-[#F85149]">Unavailable: {g.unavailable_reason}</div>
                ) : (
                  <>
                    {g.verified_units.length > 0 && (
                      <div className="text-[11px] text-[#C9D1D9]">
                        <span className="font-mono text-[#3FB950]">Verified tape:</span> {g.verified_units.map((u) => u.label).join(" · ")}
                      </div>
                    )}
                    {g.listener_profile && (
                      <div className="text-[11px] text-[#8B949E] space-y-0.5">
                        <div><b className="text-[#C9D1D9]">First audio:</b> {g.listener_profile.first_audio}</div>
                        <div><b className="text-[#C9D1D9]">Clips before narration:</b> {g.listener_profile.voices_before_first_narration}</div>
                        <div><b className="text-[#C9D1D9]">First mention of friendship:</b> {g.listener_profile.first_friendship_mention || "none"}</div>
                        <div><b className="text-[#C9D1D9]">Open questions in opening:</b> {g.listener_profile.confusion_terms.join(", ") || "none"}</div>
                      </div>
                    )}
                    {g.candidate && (
                      <div className="text-[11px] text-[#3FB950] flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> {g.candidate.integrity.protected_after}/{g.candidate.integrity.protected_before} protected blocks intact
                      </div>
                    )}
                    {g.bridge_revisions_required.length > 0 && (
                      <div className="text-[11px] text-[#D29922] space-y-0.5">
                        <div className="font-mono">NARRATION TO REVISE BEFORE THIS OPENING IS READY:</div>
                        {g.bridge_revisions_required.map((b, i) => <div key={i}>· {b.detail}</div>)}
                      </div>
                    )}
                    <div className="flex gap-2 mt-auto pt-2">
                      {g.candidate ? (
                        <>
                          <button onClick={() => copy(g.gateway.id, g.candidate!.markdown)} className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-[#21262D] border border-[#30363D] text-[#C9D1D9] hover:border-[#58A6FF]">
                            {copiedId === g.gateway.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
                          </button>
                          <button onClick={() => applyCandidate(g.candidate!)} disabled={Boolean(busy)} className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-[#1F6FEB] hover:bg-[#388BFD] text-white disabled:opacity-50">
                            Apply (checkpoint saved)
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] text-[#6E7681]">This is the current draft.</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== EDITORIAL LOOP ===================== */}
      {panel === "editorial" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(["writer", "critic"] as const).map((role) => {
              const p = providers?.[role];
              return (
                <div key={role} className="bg-[#0D1117] border border-[#30363D] rounded p-3 space-y-1">
                  <div className="text-xs font-mono font-bold text-[#C9D1D9] uppercase">{role === "writer" ? "Lead writer (ChatGPT)" : "Independent critic (Gemini)"}</div>
                  {p ? (
                    <>
                      <div className={`text-xs font-semibold ${p.available ? "text-[#3FB950]" : "text-[#F85149]"}`}>{p.available ? "Available" : "Unavailable"}: {p.display_name}{p.model ? ` · ${p.model}` : ""}</div>
                      {p.reason.length > 160 ? (
                        <details className="text-[11px] text-[#8B949E] break-words">
                          <summary className="cursor-pointer">{p.reason.slice(0, 150)}…</summary>
                          {p.reason}
                        </details>
                      ) : (
                        <div className="text-[11px] text-[#8B949E] break-words">{p.reason}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-[11px] text-[#8B949E]">Checking…</div>
                  )}
                </div>
              );
            })}
          </div>
          <SourceNote kind="Loop:" text="Narrative Intelligence finds issues, ChatGPT proposes the most consequential change (or none), Gemini evaluates the result without seeing ChatGPT's reasoning or earlier scores. Regressions are rolled back and the strongest version is kept. The result is staged; the master changes only when you accept it." />
          <div className="flex flex-wrap items-end gap-3">
            {[
              ["Max iterations", iterations, setIterations, 1, 5],
              ["Narrative threshold", narrThreshold, setNarrThreshold, 50, 100],
              ["Craft threshold", craftThreshold, setCraftThreshold, 50, 100],
            ].map(([label, value, setter, min, max]) => (
              <label key={String(label)} className="text-[11px] text-[#8B949E] space-y-1">
                <div>{String(label)}</div>
                <input
                  type="number"
                  min={Number(min)}
                  max={Number(max)}
                  value={Number(value)}
                  onChange={(e) => (setter as (n: number) => void)(Math.max(Number(min), Math.min(Number(max), Number(e.target.value) || Number(min))))}
                  className="w-24 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3]"
                />
              </label>
            ))}
            <button
              onClick={runLoop}
              disabled={Boolean(busy) || !providers?.writer.available || !providers?.critic.available}
              title={!providers?.writer.available ? "Requires the ChatGPT writer; Gemini is never substituted for it." : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2EA043] disabled:opacity-40 text-white"
            >
              <Workflow className="w-3.5 h-3.5" /> Run editorial loop
            </button>
          </div>

          {run && (
            <div className="bg-[#0D1117] border border-[#30363D] rounded p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-mono font-bold text-[#E6EDF3]">Stopped: {run.stop_reason.replace(/_/g, " ")}</span>
                <span className="text-[#8B949E]">{run.stop_detail}</span>
                <span className="font-mono text-[#6E7681] ml-auto">{run.calls_used} model calls · ~{Math.round(run.estimated_tokens_used / 1000)}k tokens{run.simulated ? " · SIMULATED" : ""}</span>
              </div>
              <div className="space-y-1">
                {run.iterations.map((it) => (
                  <div key={it.iteration} className="text-[11px] text-[#C9D1D9] border-l-2 border-[#30363D] pl-2">
                    <span className="font-mono text-[#58A6FF]">#{it.iteration} {it.verdict.replace(/_/g, " ")}</span>
                    {it.effective_scores && <span className="font-mono text-[#8B949E]"> · narrative {it.effective_scores.narrative} / craft {it.effective_scores.craft}{it.critic_scope ? ` (${it.critic_scope} review)` : ""}</span>}
                    <div className="text-[#8B949E]">{it.writer_summary}</div>
                    {it.op_results.filter((r) => r.status !== "noop").map((r) => <div key={r.op_id} className={r.status === "applied" ? "text-[#3FB950]" : "text-[#F85149]"}>· {r.status}: {r.detail}</div>)}
                    {it.recommendation_responses.map((r) => <div key={r.recommendation_id} className="text-[#8B949E]">· {r.verdict} {r.recommendation_id}: {r.reason}</div>)}
                    {it.notes.map((n, i) => <div key={i} className="text-[#D29922]">· {n}</div>)}
                  </div>
                ))}
              </div>
              {run.candidate ? (
                <div className="border-t border-[#30363D] pt-2 space-y-2">
                  <div className="text-xs text-[#E6EDF3] font-semibold">Staged candidate: {run.candidate.label} ({run.candidate.status})</div>
                  <div className="text-[11px] text-[#3FB950]"><ShieldCheck className="inline w-3.5 h-3.5" /> {run.candidate.integrity.protected_after}/{run.candidate.integrity.protected_before} protected blocks intact</div>
                  {run.candidate.notes.map((n, i) => <div key={i} className="text-[11px] text-[#8B949E]">{n}</div>)}
                  {run.candidate.status === "staged" && (
                    <div className="flex gap-2">
                      <button onClick={() => applyCandidate(run.candidate!)} className="px-3 py-1 rounded text-[11px] bg-[#1F6FEB] hover:bg-[#388BFD] text-white">Accept into master (checkpoint saved)</button>
                      <button onClick={() => rejectCandidate(run.candidate!)} className="px-3 py-1 rounded text-[11px] bg-[#21262D] border border-[#30363D] text-[#C9D1D9]">Reject</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-[#3FB950] border-t border-[#30363D] pt-2">No candidate: the current master remains the strongest version. NO CHANGE REQUIRED is a valid outcome.</div>
              )}
              <details>
                <summary className="text-[11px] font-mono text-[#8B949E] cursor-pointer">Run log</summary>
                <pre className="mt-1 text-[10px] text-[#8B949E] whitespace-pre-wrap">{run.log.join("\n")}</pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
