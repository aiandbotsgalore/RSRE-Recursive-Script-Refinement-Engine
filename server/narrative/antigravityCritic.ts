/**
 * Gemini critic through the Antigravity CLI (`agy`), signed in with the user's Google account
 * (no API key). Chosen by the user on 2026-10-21: Antigravity offers Gemini only as 3.8 Flash,
 * which the user explicitly approved for this critic role.
 *
 * Headless protocol (verified against agy 1.4.0):
 *   agy -p= --input-format stream-json --output-format stream-json --json-schema <file> --model <id>
 *   stdin:  {"event":"user","message":{"content":"<prompt>"}}
 *   stdout: NDJSON events; the final {"event":"result","result":{status, structured_output, response, ...}}
 * The prompt travels on stdin, so long manuscripts never hit the Windows command-line limit.
 * Runs in an empty temporary folder with API keys removed from the environment, so the Google login is used.
 */

import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { CriticProvider, ProviderIdentity } from "../../src/utils/narrative/providers.ts";
import { renderCriticPrompt, renderListenerPrompt } from "../../src/utils/narrative/providers.ts";
import { geminiListenerPredictionSchema, geminiNarrativeReportSchema } from "../../src/utils/narrative/narrativeReport.ts";
import { CRITIC_STORY_REVIEW_SYSTEM_PROMPT, LISTENER_SIMULATION_SYSTEM_PROMPT } from "../../src/utils/prompts.ts";

export const AGY_MODEL = process.env.RSRE_AGY_MODEL || "gemini-3.8-flash-high";

export interface AgyStatus {
  available: boolean;
  bin: string | null;
  version: string | null;
  model: string;
  models: string[];
  reason: string;
}

export interface AgyRunResult {
  data: unknown;
  conversation_id: string;
  tool_steps: string[];
  denied_actions: string[];
  usage: Record<string, number>;
}

function resolveAgyBin(): string | null {
  const candidates = [
    process.env.AGY_BIN,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe") : undefined,
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const probe = spawnSync("agy", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  return probe.status === 0 ? "agy" : null;
}

function cleanEnv(): NodeJS.ProcessEnv {
  // Without these, the Google sign-in is used instead of the free-tier API key.
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  return env;
}

let cached: { at: number; status: AgyStatus } | null = null;

export function checkAgyStatus(force = false): AgyStatus {
  if (!force && cached && Date.now() - cached.at < 5 * 60_000) return cached.status;
  const bin = resolveAgyBin();
  let status: AgyStatus;
  if (!bin) {
    status = { available: false, bin: null, version: null, model: AGY_MODEL, models: [], reason: "Antigravity CLI (agy) not found. Set AGY_BIN." };
  } else {
    const ver = spawnSync(bin, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15000, env: cleanEnv() });
    const list = spawnSync(bin, ["models"], { encoding: "utf8", windowsHide: true, timeout: 90_000, env: cleanEnv(), cwd: os.tmpdir() });
    const models = `${list.stdout || ""}`
      .split(/\r?\n/)
      .map((l) => l.split("\t")[0].trim())
      .filter((l) => /^[a-z0-9][\w.-]+$/i.test(l));
    const ok = models.includes(AGY_MODEL);
    status = {
      available: ok,
      bin,
      version: (ver.stdout || "").trim() || null,
      model: AGY_MODEL,
      models,
      reason: ok
        ? `Antigravity (Google sign-in), model ${AGY_MODEL}. No API key used.`
        : models.length === 0
        ? `Antigravity CLI did not list any models (not signed in?): ${`${list.stderr || ""}`.trim().slice(0, 160)}`
        : `Model ${AGY_MODEL} is not offered to this account. Available: ${models.join(", ")}.`,
    };
  }
  cached = { at: Date.now(), status };
  return status;
}

/** Converts the Gemini OpenAPI-style schema ("OBJECT", "STRING") into standard JSON Schema. */
export function toStandardJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStandardJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "type" && typeof v === "string") out[k] = v.toLowerCase();
    else if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toStandardJsonSchema(pv)]));
    } else out[k] = toStandardJsonSchema(v);
  }
  return out;
}

/** Parses agy stream-json output. Pure, so it is unit tested without calling the CLI. */
export function parseAgyStream(stdout: string): AgyRunResult {
  const toolSteps: string[] = [];
  let result: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t);
    } catch {
      continue;
    }
    if (ev.event === "step_update") {
      const su = (ev.step_update || {}) as Record<string, unknown>;
      const type = String(su.step_type || "");
      if (type && !/^(agent_response|thinking|planner_response|user_input|finish)$/i.test(type) && su.state === "DONE") toolSteps.push(type);
    }
    if (ev.event === "result") result = (ev.result || {}) as Record<string, unknown>;
  }
  if (!result) throw new Error("Antigravity produced no result event.");
  const denied = Array.isArray(result.denied_actions)
    ? (result.denied_actions as Array<Record<string, unknown>>).map((d) => String(d.display_name || d.action || ""))
    : [];
  if (result.status !== "SUCCESS") throw new Error(`Antigravity error: ${String(result.error || result.status || "unknown")}`);
  let data: unknown = result.structured_output;
  if (data === undefined || data === null) {
    const text = String(result.response || "").trim();
    if (!text) {
      throw new Error(`Antigravity returned no answer${denied.length ? ` (the model tried to use blocked tools: ${denied.join(", ")})` : ""}.`);
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    data = JSON.parse(first !== -1 && last > first ? text.slice(first, last + 1) : text);
  }
  return {
    data,
    conversation_id: String(result.conversation_id || ""),
    tool_steps: toolSteps,
    denied_actions: denied,
    usage: (result.usage || {}) as Record<string, number>,
  };
}

export async function runAgyJson(prompt: string, schema: unknown, opts: { timeoutMs?: number } = {}): Promise<AgyRunResult> {
  const status = checkAgyStatus();
  if (!status.available || !status.bin) throw new Error(status.reason);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsre-agy-"));
  const schemaPath = path.join(dir, "schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  const timeoutMs = opts.timeoutMs ?? Number(process.env.RSRE_AGY_TIMEOUT_MS || 900_000);
  const args = [
    "-p=",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--model", AGY_MODEL,
    "--disable-slash-commands",
    "--json-schema", schemaPath,
    "--print-timeout", `${Math.round(timeoutMs / 1000)}s`,
  ];
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(status.bin as string, args, { cwd: dir, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let out = "";
      let errTail = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (errTail = (errTail + c.toString("utf8")).slice(-2000)));
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Antigravity timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs + 60_000);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (out.includes('"event":"result"')) resolve(out);
        else reject(new Error(`Antigravity exited without a result: ${errTail.trim().slice(-300)}`));
      });
      child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
      child.stdin.end();
    });
    return parseAgyStream(stdout);
  } finally {
    // Only removes the temporary folder this function created. Antigravity can keep it open briefly
    // after exiting, so cleanup is best effort and never hides the model's result.
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } catch {
      // Left in the OS temp folder; harmless.
    }
  }
}

const NO_TOOLS =
  "IMPORTANT: Do not use any tools (no commands, files, browser, or web search). Answer only from the text in this message, then return the JSON object that matches the schema.";

export function createAntigravityCritic(): CriticProvider & { identity: ProviderIdentity } {
  const identity: ProviderIdentity = {
    provider_id: "gemini-antigravity",
    display_name: "Gemini (Antigravity, Google sign-in)",
    role: "critic",
    model: AGY_MODEL,
    kind: "live",
  };
  return {
    identity,
    async evaluate(input) {
      const res = await runAgyJson(
        `${CRITIC_STORY_REVIEW_SYSTEM_PROMPT}\n\n${NO_TOOLS}\n\n${renderCriticPrompt(input)}`,
        toStandardJsonSchema(geminiNarrativeReportSchema())
      );
      return res.data;
    },
    async predictListener(context) {
      const res = await runAgyJson(
        `${LISTENER_SIMULATION_SYSTEM_PROMPT}\n\n${NO_TOOLS}\n\n${renderListenerPrompt(context)}`,
        toStandardJsonSchema(geminiListenerPredictionSchema())
      );
      // A cold listener must not gain outside knowledge: discard the prediction if any tool actually ran.
      if (res.tool_steps.length > 0) {
        throw new Error(`Listener prediction discarded: the model used tools (${res.tool_steps.join(", ")}), which could leak outside knowledge.`);
      }
      return res.data;
    },
  };
}
