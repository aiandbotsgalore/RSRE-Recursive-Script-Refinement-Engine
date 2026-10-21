# Project Handoff Briefing for Claude Code

### 1. High-Level Summary
* **What I am building:** **RSRE Story Studio** (*Recursive Script Refinement Engine*), a specialized audio showrunner and script refinement environment for **THE PAPER TRAIL**—a premium, narrative-driven investigative podcast Benchmark: *Serial* and *Pretend*, told in Logan Black's natural speaking voice.
* **Current State:** The deterministic audio guardrails, primary quote locking, cross-chapter resonance linker, character complexity tracker, and tape freshness doctor are 100% implemented and passing all 11 unit test suites.
* **The Specific Goal:** Build the **Narrative Intelligence & Story Architecture Studio** (the macro-story engine that evaluates *The Paper Trail* as one continuous 13-chapter documentary rather than isolated scenes).

---

### 2. Project Structure
* **Repository Root:** `C:\Users\Logan\antigravity\RSRE-—-Recursive-Script-Refinement-Engine`
* **Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Node.js Test Runner (`tsx`).
* **Key Files:**
  * `src/utils/scriptEngine.ts`: Core deterministic engine (parsing, locked-cue guardrails, resonance linker, character complexity, tape freshness doctor).
  * `src/utils/sampleManuscript.ts`: Full 13-chapter baseline manuscript (`INITIAL_MANUSCRIPT`).
  * `src/utils/scriptEngine.test.ts`: Complete unit test suite run via `npx tsx --test src/utils/scriptEngine.test.ts`.
  * `src/components/MasterScriptTab.tsx`: Interactive 13-chapter studio with inline analysis drawers and per-block surgical patch splicing.
  * `src/components/ResonanceTab.tsx`: Cross-chapter echo, foreshadowing, and contradiction workbench (Tab 6).
  * `src/components/ComplexityTab.tsx`: Relationship & Human Complexity Tracker workbench (Tab 7).
  * `src/components/TapeDoctorTab.tsx`: Tape Hand-Off & Freshness Doctor workbench (Tab 8).
  * `src/App.tsx`: Main workspace state, active tabs, and checkpointing.
  * `server.ts` & `src/utils/prompts.ts`: Express backend handling Gemini/ChatGPT audit and rewrite loops.

---

### 3. What's Working vs. What Needs to Be Built

#### What is working:
* **Tag & Audio Integrity:** All archival recordings (`>`) and cue headers (`[ARCHIVAL]`, `[LOGAN READING]`) are strictly locked and read-only.
* **Deterministic Analysis:** 
  * Cross-Chapter Resonance & "Double-Take" Callbacks (Tab 6).
  * Character Arcs & "Sav in the Middle" Agency Scanner (Tab 7).
  * Lead-in Spoilers & Post-Tape Over-Explanation Doctor (Tab 8).
* **Test Status:** 11 of 11 tests pass (`npx tsx --test src/utils/scriptEngine.test.ts`), and `npm run lint` (`tsc --noEmit`) passes with 0 errors.

#### What needs to be built (The exact scope):
Build the **Narrative Intelligence Engine** across four batched components:

1. **Macro-Story Architecture Doctor:**
   * Audit all 13 chapters as a single narrative arc.
   * Categorize each chapter: `Crucial Story Turn`, `Supporting Human Texture`, or `Pacing Drag / Redundant`.
   * Flag pacing bottlenecks (e.g., three consecutive scenes stuck in forum screenshots).
   * Recommend macro actions: `Keep`, `Move`, `Merge`, or `Trim`.
2. **"Fresh Listener" Mental Model Simulator:**
   * Chapter-by-chapter tracking of what an outside listener knows, suspects, and feels.
   * **Curiosity Tracker:** Defines the single urgent question the listener needs answered next.
   * **Insider Lore Scanner:** Flags unexplained usernames, forum jargon, or dates that confuse new listeners.
3. **Cold Open & Alternate Openings Laboratory:**
   * Audition 3 distinct narrative gateways without altering audio tape:
     * *Gateway A (Allegations First — Current Draft)*
     * *Gateway B (The Friendship First — Emotional Grounding)*
     * *Gateway C (The Ticking Clock — Digital Surveillance Theme)*
4. **UI Integration & AI Prompt Upgrade:**
   * Create `src/components/NarrativeIntelligenceTab.tsx` (Tab 9 in `App.tsx`).
   * Add inline `[Story Arc]` badges and drawers to `MasterScriptTab.tsx`.
   * Upgrade Gemini review prompts in `prompts.ts` from sentence-level copy editing to **Executive Producer Story Review**.

---

### 4. Constraints & Non-Negotiables
* **Strict Tape Protection:** Archival blockquotes (`>`) and `[ARCHIVAL]` cue lines must **NEVER** be modified by any patch or rewrite. Only `[Male Narrator]` blocks are mutable.
* **Editorial Philosophy (Option D):** Conversational, investigative storytelling (*Serial* / *Pretend* style). Direct, intelligent, skeptical, understated. No courtroom cross-examination, no melodramatic true-crime clichés.
* **Environment:** Windows (pwsh). Note that `npm install` requires `--legacy-peer-deps`.
* **Testing Requirement:** Add comprehensive unit tests in `src/utils/scriptEngine.test.ts` for all new analyzers and ensure `npm run lint` passes with 0 errors.

---

### 5. Autonomy Directive
Execute directly: Create the new component files, update the engine and tests, verify using `npx tsx --test src/utils/scriptEngine.test.ts` and `npm run lint`, and report the final verified state.
