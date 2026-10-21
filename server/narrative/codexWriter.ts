/**
 * ChatGPT writer via the locally installed Codex CLI, authenticated with the user's existing
 * ChatGPT subscription (no OpenAI API key, no new paid API dependency).
 *
 * Runs `codex exec` headless: read-only sandbox, ephemeral session (nothing saved to Codex history),
 * an empty temporary working directory, and a strict JSON output schema. The prompt is sent on stdin.
 */

import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ProviderIdentity, WriterProvider } from "../../src/utils/narrative/providers.ts";
import { renderWriterPrompt } from "../../src/utils/narrative/providers.ts";
import { writerProposalJsonSchema } from "../../src/utils/narrative/narrativeReport.ts";
import { WRITER_ARCHITECT_SYSTEM_PROMPT } from "../../src/utils/prompts.ts";

export interface CodexStatus {
  available: boolean;
  bin: string | null;
  version: string | null;
  logged_in_with_chatgpt: boolean;
  model: string;
  reason: string;
  /** Every binary that was checked and why it was or was not usable. */
  checked: Array<{ bin: string; usable: boolean; note: string }>;
  last_live_call: { ok: boolean; at: string; detail: string } | null;
}

/**
 * Optional `-c service_tier=...` override. Only needed for older CLIs that cannot parse a newer
 * config file. Not applied unless CODEX_SERVICE_TIER is set, because ChatGPT logins reject "flex"
 * and "fast" consumes subscription usage faster.
 */
function configOverrides(): string[] {
  return process.env.CODEX_SERVICE_TIER ? ["-c", `service_tier="${process.env.CODEX_SERVICE_TIER}"`] : [];
}

function npmGlobalRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.APPDATA) roots.add(path.join(process.env.APPDATA, "npm", "node_modules"));
  roots.add(path.join("C:\\npmglobal", "node_modules"));
  try {
    const prefix = spawnSync("npm config get prefix", { encoding: "utf8", windowsHide: true, timeout: 10000, shell: true }).stdout?.trim();
    if (prefix) roots.add(path.join(prefix, "node_modules"));
  } catch {
    // npm not available: skip.
  }
  return Array.from(roots);
}

/** Candidate binaries in preference order: explicit, current npm CLI (native exe), PATH, desktop app CLI. */
function candidateBins(): string[] {
  const out: string[] = [];
  if (process.env.CODEX_BIN) out.push(process.env.CODEX_BIN);
  for (const root of npmGlobalRoots()) {
    out.push(path.join(root, "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"));
  }
  out.push("codex");
  if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe"));
  return out.filter((p, i, a) => a.indexOf(p) === i);
}

let lastLiveCall: CodexStatus["last_live_call"] = null;

function configuredModel(): string {
  if (process.env.RSRE_CODEX_MODEL) return process.env.RSRE_CODEX_MODEL;
  try {
    const cfg = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
    const m = /^\s*model\s*=\s*"([^"]+)"/m.exec(cfg);
    if (m) return `${m[1]} (from ~/.codex/config.toml)`;
  } catch {
    // No config file: Codex uses its own default.
  }
  return "Codex default model";
}

let cachedStatus: { at: number; status: CodexStatus } | null = null;

export function checkCodexStatus(force = false): CodexStatus {
  if (!force && cachedStatus && Date.now() - cachedStatus.at < 120_000) return { ...cachedStatus.status, last_live_call: lastLiveCall };
  const model = configuredModel();
  const checked: CodexStatus["checked"] = [];
  let chosen: { bin: string; version: string } | null = null;

  for (const bin of candidateBins()) {
    if (bin !== "codex" && !fs.existsSync(bin)) continue;
    const ver = spawnSync(bin, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    if (ver.error || ver.status !== 0) {
      checked.push({ bin, usable: false, note: `does not run (${ver.error?.message?.slice(0, 80) || `exit ${ver.status}`})` });
      continue;
    }
    const version = (ver.stdout || "").trim();
    const login = spawnSync(bin, [...configOverrides(), "login", "status"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const out = `${login.stdout || ""}${login.stderr || ""}`.trim();
    if (/unknown variant|Error loading configuration/i.test(out)) {
      checked.push({ bin, usable: false, note: `${version} cannot read ~/.codex/config.toml (${out.slice(0, 120)}); it is older than the config` });
      continue;
    }
    if (!/logged in using chatgpt/i.test(out)) {
      checked.push({ bin, usable: false, note: `${version} is not signed in with ChatGPT (${out.slice(0, 80) || "no output"})` });
      continue;
    }
    checked.push({ bin, usable: true, note: `${version}, signed in with ChatGPT` });
    chosen = { bin, version };
    break;
  }

  const status: CodexStatus = chosen
    ? {
        available: true, bin: chosen.bin, version: chosen.version, logged_in_with_chatgpt: true, model, checked,
        reason: "Codex CLI signed in with a ChatGPT subscription.", last_live_call: lastLiveCall,
      }
    : {
        available: false, bin: null, version: null, logged_in_with_chatgpt: false, model, checked, last_live_call: lastLiveCall,
        reason:
          checked.length === 0
            ? "Codex CLI not found. Install it (npm install -g @openai/codex) or set CODEX_BIN."
            : `No usable Codex CLI: ${checked.map((c) => `${c.bin} ${c.note}`).join("; ")}. Reinstall with: npm install -g @openai/codex@latest`,
      };
  cachedStatus = { at: Date.now(), status };
  return status;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  return JSON.parse(first !== -1 && last > first ? t.slice(first, last + 1) : t);
}

export async function runCodexJson(prompt: string, schema: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<unknown> {
  const status = checkCodexStatus();
  if (!status.available || !status.bin) throw new Error(status.reason);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsre-codex-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "last-message.json");
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  const args = [
    ...configOverrides(),
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox", "read-only",
    "--output-schema", schemaPath,
    "-o", outPath,
    "-C", dir,
    ...(process.env.RSRE_CODEX_MODEL ? ["-m", process.env.RSRE_CODEX_MODEL] : []),
    "-",
  ];
  const timeoutMs = opts.timeoutMs ?? Number(process.env.RSRE_CODEX_TIMEOUT_MS || 420_000);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(status.bin as string, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stderrTail = "";
      const keepTail = (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4000);
      };
      child.stdout.on("data", keepTail);
      child.stderr.on("data", keepTail);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Codex exited with code ${code}: ${stderrTail.trim().split("\n").slice(-4).join(" | ")}`));
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
    if (!fs.existsSync(outPath)) throw new Error("Codex finished without writing a final message.");
    const parsed = extractJson(fs.readFileSync(outPath, "utf8"));
    lastLiveCall = { ok: true, at: new Date().toISOString(), detail: "Structured response received." };
    return parsed;
  } catch (err) {
    lastLiveCall = { ok: false, at: new Date().toISOString(), detail: err instanceof Error ? err.message.slice(0, 300) : String(err) };
    throw err;
  } finally {
    // Only removes the temporary directory this function created (best effort).
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } catch {
      // Left in the OS temp folder; harmless.
    }
  }
}

export function createCodexWriter(): WriterProvider {
  const status = checkCodexStatus();
  const identity: ProviderIdentity = {
    provider_id: "chatgpt-codex",
    display_name: "ChatGPT (Codex CLI, ChatGPT subscription)",
    role: "writer",
    model: status.model,
    kind: "live",
  };
  return {
    identity,
    async propose(input) {
      return runCodexJson(`${WRITER_ARCHITECT_SYSTEM_PROMPT}\n\n${renderWriterPrompt(input)}`, writerProposalJsonSchema());
    },
  };
}

/** Strict JSON schema mirroring the existing /api/edit contract, for routing the narrator polish pass to ChatGPT. */
export function editorPatchJsonSchema(): Record<string, unknown> {
  const s = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      narrator_patches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { section_id: s, block_id: s, updated_narrator_markdown: s },
          required: ["section_id", "block_id", "updated_narrator_markdown"],
        },
      },
      editor_changelog: { type: "array", items: s },
    },
    required: ["narrator_patches", "editor_changelog"],
  };
}
