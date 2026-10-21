# The Paper Trail Script Studio: User Guide

This app helps you edit the script for *The Paper Trail*, your audio documentary. You paste in your script, and the app does three jobs:

1. **Checks it.** It runs instant checks for things like over explained tape, repeated quotes, and confusing moments for a new listener.
2. **Suggests and makes edits** using AI, but only to your own narration paragraphs. The recordings and quotes are never changed.
3. **Keeps you in control.** Bigger changes are shown to you first. Nothing big touches your script until you press a button to accept it, and a backup copy is saved each time.

---

## 1. Starting and stopping the app

**To start it:** open a terminal in the project folder and run:

```
npm run dev
```

Then open **http://localhost:3000** in Chrome. Or just ask Claude to "launch the app".

**To stop it:** press `Ctrl + C` in that terminal, or ask Claude to stop it.

**Before you start, know this:** refreshing the browser page puts the script editor back to the sample script. Your saved **Version Checkpoints** survive a refresh, but unsaved edits do not. Before you close or refresh the page, either save a checkpoint or use **Download .md File** (in tab 2).

---

## 2. How the script needs to be written

The app reads your script as plain text in Markdown format. It sorts every paragraph into one of these types:

| What it looks like | What the app calls it | Can AI change it? |
|---|---|---|
| A line starting with `>` (a quote from a recording) | Locked quote | **Never** |
| `[ARCHIVAL 03 — ANGELA \| ...]` | Archival cue (which clip plays) | **Never** |
| `[LOGAN READING ...]` or `[WRITTEN MESSAGE ...]` | Reading cue | **Never** |
| Headings (`#`, `##`), dividers (`---`), and one line production cues like `[HARD CUT.]` | Structure | **Never** |
| Ordinary paragraphs of your narration | Narrator paragraph | Yes, unless you lock it |

Each chapter or section (for example `PROLOGUE`, `CH_01`, `A101`) becomes one **section** in the app.

---

## 3. The top status bar

This box sits above the tabs and is always visible.

* **Status light:** READY TO POLISH, WORKING LIVE, COMPLETED ALL PASSES, STOPPED BY USER, or PAUSED (something failed, so click **Retry**).
* **Elapsed:** how long the current run has taken.
* **Quotes: LOCKED (number):** confirms every recorded quote is still word for word identical to your original. If it ever says **CHANGED**, something went wrong; restore a checkpoint.
* **Privacy: PASS / FAIL:** checks the script for a list of private phrases that must never appear (you can see the list in **Editorial Guide**). FAIL shows a red warning above the editor naming the section.
* **Quote Echoes:** counts places where your narration repeats what a recording is about to say, or has just said. Click it to see them.
* **Target Score:** the quality score (out of 100) you want. The run stops early once it gets there.
* **Passes (Min 3):** the **most** passes the run is allowed. It can stop after only 1 pass if the AI decides nothing needs changing.
* **Audit & Polish Script:** the main button. See section 5 below.
* **Stop:** stops a run. Edits already made are kept.
* **Activity feed:** the last few things the app did, with times.
* **Version Checkpoints:** your backup system.
  * Type a name and click **Save Draft Checkpoint** to save the script as it is now.
  * Pick a checkpoint from the list and click **Restore Full Script** to go back to it.
  * Pick a section and click **Rollback Single Section** to bring back just that one section from the chosen checkpoint, keeping everything else.
  * The app keeps your last 12 checkpoints, stored in Chrome on this computer.

---

## 4. The two header buttons (top right)

* **AI Co-Pilot:** opens or closes a chat panel beside whatever tab you are on (see tab 10).
* **Editorial Guide:** shows the show's permanent rules: the storytelling charter, the 100 point scoring rubric, and the list of private phrases.

---

## 5. What "Audit & Polish Script" does

This is the original editing loop. Each **pass** has two steps:

1. **Audit.** Gemini reads the whole script and scores it out of 100, using five categories worth 20 points each:
   * Narrative journey and pacing for the ear
   * Authentic firsthand voice (sounds like Logan)
   * How well tape is used and set up
   * Human complexity and factual accuracy
   * Earned revelations and connections across chapters

   It also lists specific sections that need work, and why. Before scoring, it considers the whole story structure and how a first time listener would experience it.
2. **Edit.** The writer AI rewrites only the narrator paragraphs in those flagged sections. Locked quotes, cues, and paragraphs you locked are never touched.

**The loop stops when any of these happen:**
* The score reaches your Target Score.
* The auditor finds nothing worth changing. This shows as **NO CHANGE REQUIRED**, a normal and good result.
* The writer decides the flagged narration is already working.
* A pass makes the score drop. The app then restores the best scoring version automatically.
* It reaches your maximum number of passes.
* You click **Stop**.

When a pass finishes, the app jumps to tab 2 so you can see the result.

---

## 6. The ten tabs

### 1. Your Draft Script
Where your script lives. It has two views:
* **Raw Markdown Editor:** a big text box. Paste your script here or type in it.
* **Interactive Section Controls & 3 Variants:** the same clickable view as tab 2.

Buttons:
* **Upload .md / .txt:** load a script file from your computer.
* **Reset to Sample Draft:** go back to the built in sample script.
* **Clear:** empty the editor.

Typing in the editor makes that text the new starting point for comparisons.

### 2. Final Polished Script
The current script, section by section, with tools on every section.

**View switches:** Annotated (with labels and tools), **Clean Markdown** (plain text), and **Original vs. Edited** (your starting draft beside the current one).

**Top buttons:** **Copy Final Script**, **Download .md File**, and **Run Full 3-Pass Polish** (the same as Audit & Polish).

**Buttons on each section:**
* **Polish Just This Section:** AI improves the narration in this section only.
* **Cut Word Count 25%:** AI trims the narration by about a quarter.
* **Sharpen Lead-In to Quote:** AI fixes narration that gives away or repeats a recording.
* **Lock Section / Section Locked:** protects every narrator paragraph in this section from all AI edits. You can also lock single paragraphs.
* **[Story Arc] badge:** opens a drawer with this section's role in the whole story (see tab 9), what it depends on, and what a first time listener knows at this point.
* Small badges for **resonance**, **character arc**, and **tape freshness** open details from tabs 6, 7, and 8 for that section.

**3 Showrunner Variants** on a narrator paragraph shows rewrite options in different styles:
* **Option D, Signature Style** (the default: conversational investigative storytelling)
* **Option A,** Dry and Minimalist
* **Option B,** Forensic and Investigative
* **Option C,** Conversational Serial Cadence

Click one to put it in your script.

### 3. Changes Made
Every edit the AI made, grouped by pass. Removed words and added words are highlighted. Switch between **Highlighted Changes** and **Side-by-Side**. Locked quotes appear in their place so you can see they were not touched. You can also lock a paragraph from here so later passes leave it alone.

### 4. Script Quality Score
The score report for each pass: the total, the five category scores, what is working, what needs work, and the auditor's specific instructions. Click a section to jump to its changes in tab 3.

### 5. Receipt Board
The evidence view. It lists every document, screenshot, and message the script relies on ("receipts"), plus:
* **Contradiction & Callback Helper:** pairs an early statement with a later one that contradicts or echoes it, with suggested narration to join them.
* **Quote-Echo & Cliffhanger Check:** finds narration that repeats the tape, and rates how strongly each section ends (**Strong Turns** versus sections that need a **Sharpen Exit**).

### 6. Cross-Chapter Resonance
Finds moments where an early line or clip gains new meaning later (a "double take"). Each item is marked **Earned in Draft** (already works), **Needs Softening** (sounds too much like a verdict), or **Latent Opportunity** (a connection you could make). Most come with ready to use narration you can **Copy**, **Discuss with Co-Pilot**, or **Audition & Splice** (insert into the script).

### 7. Human Complexity & Arcs
Checks that real people stay human rather than becoming heroes or villains. It tracks Sav's agency, guards against making Angela a cartoon villain, and shows each chapter's emotional state and relationship dynamics. It gives a complexity percentage and suggests narration to add nuance.

### 8. Tape Freshness Doctor
Finds two common problems:
* **Spoilers:** narration that announces what a clip is about to say.
* **Recaps:** narration that summarizes a clip right after it plays.

Each problem shows the clip (unchanged), your current narration, and a fresher alternative you can copy or splice in.

### 9. Narrative Intelligence
The newest tab. It looks at the documentary as **one continuous story** instead of separate scenes. It has four panels. **Nothing in this tab changes your script until you click an Apply or Accept button, and each time it saves a checkpoint first.**

Across the top it counts **Story turns**, **Texture**, **Drag**, and **Listener flags**.

**Story Architecture**
* Gives every scene a role:
  * **Crucial Story Turn:** the story would break without it.
  * **Supporting Human Texture:** it deepens people and relationships.
  * **Pacing Drag:** it repeats what the listener already knows.
* Each scene also gets a suggested action: **Keep**, **Move**, **Merge**, or **Trim**, with the reason.
* Warns about **pacing bottlenecks**, such as several document heavy scenes in a row.
* **Narrative Dependencies** lists links between scenes (a callback to an earlier moment, a promise paid off later, a flashback). These matter because moving a scene can break them.
* **Run Gemini story review:** Gemini reads the whole script as an independent critic. It gives a summary, the central question of the story, a narrative score, a craft score, notes on each scene, and suggested reorderings. It takes about 1 to 2 minutes. The result is saved, so the same version of the script will not be reviewed twice.

**Fresh Listener**
* Imagines someone who has never heard of these people, X Spaces, or this conflict, and walks through the script in order. Each scene only "knows" what came before it.
* For each scene it shows what the listener **learned**, the **question** pulling them forward, and **flags** for confusion: an unnamed voice, an unexplained name, an insider word like "receipts" or "Spaces", or a recording with no date.
* Each flag also says whether a later scene explains it ("resolved in CH_03") or never does.
* **Simulate next 3 scenes with Gemini:** asks Gemini to predict, three scenes at a time, how a new listener would feel: what they infer, what they are curious about, their emotional investment, and whether they are getting tired. These are clearly labeled as AI guesses, not audience data.

**Openings Lab**

Compares three ways to open the documentary. They are built only by reordering recordings that already exist; no new words are invented.
* **Gateway A:** your current opening.
* **Gateway B:** opens on "So Logan was the second space".
* **Gateway C:** opens on the screenshot clips ("I screenshot in real time").

For each one it shows the first audio, how many clips play before narration starts, when the friendship is first mentioned, and which terms would confuse a new listener. If an opening needs some narration rewritten to make sense (for example lines that say "first" or "second"), it lists them under **Narration to revise**. Click **Copy** to copy that version, or **Apply (checkpoint saved)** to use it.

**Editorial Loop**

The new two AI editing loop:
1. The app finds issues.
2. **ChatGPT (the writer)** proposes the most important change, or decides no change is needed.
3. **Gemini (the critic)** judges the result without seeing ChatGPT's reasoning or earlier scores, so it stays independent.
4. This repeats up to your **Max iterations**, until both the **Narrative threshold** and **Craft threshold** scores are reached, or until progress stops.

If a change makes things worse, it is undone and the strongest version is kept. At the end you get a **staged candidate**. Click **Accept into master (checkpoint saved)** or **Reject**. If the loop finds nothing worth changing, it says so; that is a valid result. The two boxes at the top show whether each AI is currently available.

### 10. AI Co-Pilot & Spot Review
A chat with an AI that knows your current script and everything the app has found. You can:
* Ask questions ("Which chapter drags the most?").
* Ask for a quick review: it lists **Strengths** and **Areas to Tighten**.
* Ask for edits ("Rewrite A101 to be punchier"). The edits appear with an **Apply Surgical Edit** button and an explanation of why.

**Auto-apply requested edits** is on by default. While it is on, asking the Co-Pilot to rewrite or fix something puts the edit straight into your script. Turn it off if you want to review every edit first. The same chat can also be opened beside any other tab with the **AI Co-Pilot** button in the header. Many other tabs have **Ask Co-Pilot** buttons that send it a ready made question.

---

## 7. Which AI does what

| Feature | AI used | How it signs in |
|---|---|---|
| Tabs 3 to 8 checks, Story Architecture roles, Fresh Listener flags, Openings Lab | **No AI.** Instant rules built into the app | Nothing needed |
| Audit & Polish, section buttons, 3 Variants, Co-Pilot chat | Gemini | Your Gemini API key (in `.env`) |
| Gemini story review and listener predictions (tab 9) | Gemini 3.8 Flash | Your Google sign in through Antigravity, no API key |
| Editorial Loop writer (tab 9) | ChatGPT via Codex | Your ChatGPT sign in |
| Audit & Polish edit step | ChatGPT via Codex when it works, otherwise Gemini (labeled as not independent) | As above |

---

## 8. Safety nets

* Recorded quotes, archival cues, reading cues, and headings can never be edited by any AI. The app checks this after every change, and the **Quotes: LOCKED** badge proves it.
* Paragraphs and sections you lock are skipped by every AI feature.
* Every Apply or Accept in tab 9 saves a checkpoint of the version before it.
* If your script changed after a tab 9 suggestion was built, the app refuses to apply the old suggestion and asks you to rebuild it, so it can never overwrite newer work.
* A run that makes the score worse puts the best version back automatically.
* If an AI fails, the app shows an error instead of quietly making up an edit or a score.

---

## 9. Known limits right now

* **ChatGPT is turning requests away.** Codex is installed and signed in, but OpenAI replies "Selected model is at capacity". Until that clears, **Run editorial loop** will fail, and the edit step of Audit & Polish falls back to Gemini.
* **The older features may use Flash models.** Audit & Polish, the section buttons, and the Co-Pilot use your Gemini API key. Because it is a free tier key, the Pro models are blocked, so these features fall back to Gemini Flash models. This goes against your "no Flash" rule and has not been changed yet.
* **Refreshing resets the editor** to the sample script (see section 1).
* **Labels:** the **Passes (Min 3)** box and the **Run Full 3-Pass Polish** button are older names. Runs can now stop after 1 pass.
* **Scores are guidance, not truth.** The scores and listener predictions are AI opinions to help you decide, not measurements.

---

## 10. A good way to work

1. Paste or upload your script in tab 1. Click **Save Draft Checkpoint** and name it "Before edits".
2. Open tab 9 and read **Story Architecture** and **Fresh Listener** first. Fix big structure problems before polishing sentences.
3. Click **Run Gemini story review** for an independent opinion on the whole story.
4. Try the **Openings Lab** if the opening feels weak.
5. Use tabs 5 to 8 to find specific problems, and splice in the suggestions you like.
6. Run **Audit & Polish Script** for sentence level polish, then check every edit in tab 3.
7. Save a checkpoint after anything you like, and **Download .md File** when you are done.

---

## 11. Where things are saved

| What | Where |
|---|---|
| Version Checkpoints (last 12) | In Chrome on this computer |
| Gemini reviews, listener predictions, staged candidates, loop history | The `.rsre-data/narrative` folder inside the project |
| Backup of the app from before the Narrative Intelligence work | `C:\Users\Logan\antigravity\RSRE-backup-2026-10-20` |
| Technical notes for developers | `NARRATIVE_ENGINE.md` in the project folder |
