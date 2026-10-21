# Narrative Intelligence Engine

Implements HANDOFF.md as revised by HANDOFF2.md. Backup of the pre-change source: `C:\Users\Logan\antigravity\RSRE-backup-2026-10-20`.

## Modules (`src/utils/narrative/`)

| File | Role |
|---|---|
| `hash.ts` | Manuscript version ids and content hashes (stable identity for scenes and tape). |
| `knowledgeBase.ts` | Project knowledge as data: aliases, insider glossary, opening hypotheses. No chapter count or cast is hardcoded in logic. |
| `storyModel.ts` | Story model derived from the manuscript: scenes, tape units, speakers, dependencies (callback, promise, flashback, order references, resonance, tape references), roles, macro actions, bottlenecks. Incremental: semantic analysis is cached by scene content hash. |
| `listenerModel.ts` | First time listener model. Presented information only, in order. Leak free context builder plus an isolation check. AI predictions are stored separately and labeled as predictions. |
| `structuralOps.ts` | Keep, Move (scene or tape unit), Merge, Trim, Reorder. Content identity integrity, unit cohesion, version checks, continuity risks, listener impact. Candidates keep the exact base text for rollback. |
| `openingsLab.ts` | Gateways A, B, C built only by reordering verified tape in the opening scene. |
| `narrativeReport.ts` | Narrative report contract, validator for model output, Gemini and ChatGPT schemas. |
| `providers.ts` | Writer and critic contracts, prompt renderers, labeled mock providers. |
| `orchestrator.ts` | Writer and critic loop with no forced edits, best version retention, regression rollback, inflation damping, cycle detection, budgets, plateau stop. Never writes the master. |

Server: `server/narrative/codexWriter.ts` (ChatGPT via Codex CLI on the ChatGPT subscription), `geminiCritic.ts` (Pro models only), `store.ts` (persistence in `.rsre-data/narrative`, git ignored).

Routes: `GET /api/narrative/providers`, `POST /api/narrative/analyze`, `/review`, `/listener`, `/run`, `GET|POST /api/narrative/candidates`, `POST /api/narrative/candidates/:id/decision`, `GET /api/narrative/history`.

UI: Tab 9 `NarrativeIntelligenceTab.tsx` (Architecture, Fresh Listener, Openings Lab, Editorial Loop) and the `[Story Arc]` badge and drawer in `MasterScriptTab.tsx`.

## Forced edit removal

Removed: the 3 pass minimum, invented "polish 2 sections" directives (server and client), automatic cliffhanger directives, the rule based rewrite when the writer returned no change, the client fallbacks that invented directives and patches, and the co-pilot and section action filler patches. A failed live audit no longer returns a canned report labeled "live". Zero directives or zero changes now means NO CHANGE REQUIRED. The pass loop restores the best scored draft on regression.

## Provider status (October 20, 2026)

* **ChatGPT writer: installed, waiting on OpenAI capacity.** Codex CLI 0.163 was reinstalled globally and is detected and signed in with ChatGPT. Live calls currently fail with "Selected model is at capacity" for every model tried (gpt-6.1-sol, gpt-6-sol, gpt-5.6-sol), even with default settings, so the refusal is on OpenAI's side. Retry later. Override the model with `RSRE_CODEX_MODEL` if needed.
* **Gemini critic: working via Antigravity sign-in (October 21, 2026).** `server/narrative/antigravityCritic.ts` runs `agy` headless with the user's Google login (no API key) on `gemini-3.8-flash-high`, a Flash model the user explicitly approved for this role. Prompts go over stdin as `{"event":"user","message":{"content":...}}` with `--input-format stream-json`; results come back as `structured_output`. Verified live on a small fixture (complete report, sensible findings, about 50 to 100 seconds per call). Listener predictions are discarded if the agent actually ran a tool. Settings: `RSRE_CRITIC_PROVIDER` (`antigravity` default, or `gemini-api` for the Pro only API key path), `RSRE_AGY_MODEL`, `AGY_BIN`. Why not the API key: it is free tier, where `gemini-3.1-pro-preview` has a quota of 0 and `gemini-2.5-pro` is closed to new users. The Gemini CLI's own Google login is discontinued.
* The older audit, edit, and co-pilot routes still use the original fallback list, which includes Flash models.

## Verification

`npm test` (34 tests), `npm run lint`, `npm run build`. Mocked providers validate orchestration only; storytelling quality of live model output is not yet validated.
