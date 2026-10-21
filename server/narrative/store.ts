/**
 * Minimal persistent store for Narrative Intelligence state, on local disk.
 * Location: <project>/.rsre-data/narrative (override with RSRE_DATA_DIR). Ignored by git.
 *   models/<version>.json     Story models (versioned by manuscript version id)
 *   listener/<version>.json   Listener timelines
 *   reports/<version>.json    Critic narrative reports
 *   candidates/<id>.json      Staged manuscript candidates (with exact base text for rollback)
 *   runs/<id>.json            Orchestrator run records
 *   history.jsonl             Append-only decision and operation history
 *   latest.json               Pointer to the most recent model and listener versions
 */

import fs from "fs";
import path from "path";

export type StoreKind = "models" | "listener" | "reports" | "candidates" | "runs";

export function dataDir(): string {
  return process.env.RSRE_DATA_DIR || path.join(process.cwd(), ".rsre-data", "narrative");
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function ensure(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function saveJson(kind: StoreKind, id: string, value: unknown): void {
  const dir = path.join(dataDir(), kind);
  ensure(dir);
  const file = path.join(dir, `${safeId(id)}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function loadJson<T>(kind: StoreKind, id: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), kind, `${safeId(id)}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export function listIds(kind: StoreKind): string[] {
  try {
    return fs
      .readdirSync(path.join(dataDir(), kind))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

export function appendHistory(event: Record<string, unknown>): void {
  ensure(dataDir());
  fs.appendFileSync(path.join(dataDir(), "history.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

export function readHistory(limit = 200): Array<Record<string, unknown>> {
  try {
    const lines = fs.readFileSync(path.join(dataDir(), "history.jsonl"), "utf8").trim().split("\n");
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export interface LatestPointer {
  model_version_id: string | null;
  listener_version_id: string | null;
}

export function loadLatest(): LatestPointer {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), "latest.json"), "utf8")) as LatestPointer;
  } catch {
    return { model_version_id: null, listener_version_id: null };
  }
}

export function saveLatest(p: LatestPointer): void {
  ensure(dataDir());
  fs.writeFileSync(path.join(dataDir(), "latest.json"), JSON.stringify(p));
}
