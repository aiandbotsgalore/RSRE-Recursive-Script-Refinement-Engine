/**
 * Gemini as the independent editorial critic and first-time listener simulator.
 * Uses the existing Gemini integration through an injected `generate` function, restricted to
 * Pro models (no Flash fallback) so a silent downgrade cannot occur.
 */

import type { CriticProvider, ProviderIdentity } from "../../src/utils/narrative/providers.ts";
import { renderCriticPrompt, renderListenerPrompt } from "../../src/utils/narrative/providers.ts";
import { geminiListenerPredictionSchema, geminiNarrativeReportSchema } from "../../src/utils/narrative/narrativeReport.ts";
import { CRITIC_STORY_REVIEW_SYSTEM_PROMPT, LISTENER_SIMULATION_SYSTEM_PROMPT } from "../../src/utils/prompts.ts";

export type GenerateFn = (options: {
  contents: string;
  systemInstruction: string;
  temperature: number;
  responseSchema: Record<string, unknown>;
  timeoutMs?: number;
}) => Promise<{ data: unknown; modelUsed: string }>;

export const CRITIC_MODEL_CANDIDATES: readonly string[] = (process.env.RSRE_CRITIC_MODELS || "gemini-3.1-pro-preview,gemini-2.5-pro")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function createGeminiCritic(generate: GenerateFn): CriticProvider & { identity: ProviderIdentity } {
  const identity: ProviderIdentity = {
    provider_id: "gemini",
    display_name: "Gemini (independent critic)",
    role: "critic",
    model: CRITIC_MODEL_CANDIDATES.join(" / "),
    kind: "live",
  };
  return {
    identity,
    async evaluate(input) {
      const res = await generate({
        contents: renderCriticPrompt(input),
        systemInstruction: CRITIC_STORY_REVIEW_SYSTEM_PROMPT,
        temperature: 0.2,
        responseSchema: geminiNarrativeReportSchema(),
        timeoutMs: 180_000,
      });
      identity.model = res.modelUsed;
      return res.data;
    },
    async predictListener(context) {
      const res = await generate({
        contents: renderListenerPrompt(context),
        systemInstruction: LISTENER_SIMULATION_SYSTEM_PROMPT,
        temperature: 0.4,
        responseSchema: geminiListenerPredictionSchema(),
        timeoutMs: 120_000,
      });
      identity.model = res.modelUsed;
      return res.data;
    },
  };
}
