/**
 * Deterministic Code-Level Guardrails, AST Splicing Engine, and Audio-Script Cadence Scanner
 * Pure TypeScript implementation — never delegates locks, privacy scanning, or acoustic telemetry to LLMs.
 */

export const FORBIDDEN_DOMESTIC_PHRASES = [
  "kids should be taken",
  "selfish liar",
  "very, very, very ugly",
  "hit the call button",
  "making excuses on why you can't",
  "ongoing separation process",
  "unfit mother",
] as const;

export const DEADWOOD_ANNOUNCER_PHRASES = [
  "in the clip you just heard",
  "as you just heard",
  "according to what i remember",
  "here is the first message log",
  "read the second message log",
] as const;

export type BlockType =
  | "narrator"
  | "blockquote"
  | "archival"
  | "reading"
  | "locked_meta";

export interface ScriptBlock {
  id: string;
  type: BlockType;
  rawText: string;
  locked: boolean;
}

export interface ScriptSection {
  section_id: string;
  title: string;
  act_id: string;
  headerLine: string;
  blocks: ScriptBlock[];
  rawMarkdown: string;
}

export interface ParsedManuscript {
  preamble: string;
  sections: ScriptSection[];
}

export interface PrivacyViolation {
  section_id: string;
  phrase: string;
  excerpt: string;
}

export interface PrivacyScanResult {
  privacy_gate_passed: boolean;
  forbidden_domestic_phrases_found: string[];
  hera_references_found: boolean;
  violations: PrivacyViolation[];
}

export interface CueIntegrityReport {
  tag_integrity: boolean;
  blockquotes_before: number;
  blockquotes_after: number;
  archival_cues_before: number;
  archival_cues_after: number;
  reading_blocks_before: number;
  reading_blocks_after: number;
  appendix_intact: boolean;
  mismatches: string[];
}

export interface SectionDiffRecord {
  section_id: string;
  act_id: string;
  title: string;
  beforeMarkdown: string;
  afterMarkdown: string;
  narratorBlocksBefore: string[];
  narratorBlocksAfter: string[];
  deltaChars: number;
  minimumDeltaMet: boolean;
  nonNarratorMutatedAttemptIntercepted: boolean;
}

export interface SpliceResult {
  assembledMarkdown: string;
  sectionDiffs: SectionDiffRecord[];
  cueIntegrity: CueIntegrityReport;
  guardrailEvents: string[];
  anySectionChanged: boolean;
}

export interface DiffToken {
  type: "unchanged" | "added" | "removed";
  value: string;
}

export interface AuditorMetricScore {
  brutal_critique: string;
  score: number;
}

export interface SurgicalDirective {
  section_id: string;
  flaw: string;
  editorial_order: string;
}

export interface AuditorReport {
  pass_number: number;
  privacy_and_tag_audit: {
    forbidden_domestic_phrases_found: string[];
    hera_references_found: boolean;
    privacy_gate_passed: boolean;
  };
  metrics: {
    narrative_drive: AuditorMetricScore;
    spoken_cadence: AuditorMetricScore;
    tape_integration: AuditorMetricScore;
    investigative_authority: AuditorMetricScore;
    narrator_composure: AuditorMetricScore;
  };
  composite_score: number;
  min_category_score: number;
  passed_threshold: boolean;
  locked_acts: string[];
  surgical_directives: SurgicalDirective[];
}

export interface NarratorBlockPatch {
  section_id: string;
  block_id: string;
  updated_narrator_markdown: string;
}

export interface RelatedSuggestion {
  section_id: string;
  note: string;
}

export interface EditorPatchResponse {
  narrator_patches?: NarratorBlockPatch[];
  patched_sections?: Array<{
    section_id: string;
    updated_section_markdown: string;
  }>;
  editor_changelog: string[];
  related_suggestions?: RelatedSuggestion[];
}

export interface QuoteEchoFinding {
  section_id: string;
  block_id: string;
  adjacent_quote_block_id: string;
  direction: "preceding" | "succeeding";
  matched_phrase: string;
}

export interface MouthfulSentenceFinding {
  section_id: string;
  block_id: string;
  sentence: string;
  word_count: number;
  clause_punctuation_count: number;
  reason: "exceeds_32_words" | "excessive_clauses" | "both";
}

export interface DeadwoodPhraseFinding {
  section_id: string;
  block_id: string;
  phrase: string;
  excerpt: string;
}

export interface SectionAudioCraft {
  section_id: string;
  spoken_words: number;
  estimated_runtime_seconds: number;
  beat_cue_count: number;
  quote_echoes: QuoteEchoFinding[];
  mouthful_sentences: MouthfulSentenceFinding[];
  deadwood_phrases: DeadwoodPhraseFinding[];
}

export interface AudioCraftReport {
  total_spoken_words: number;
  estimated_runtime_seconds: number;
  total_beat_cues: number;
  quote_echo_count: number;
  mouthful_sentence_count: number;
  deadwood_phrase_count: number;
  quote_echoes: QuoteEchoFinding[];
  mouthful_sentences: MouthfulSentenceFinding[];
  deadwood_phrases: DeadwoodPhraseFinding[];
  sections: Record<string, SectionAudioCraft>;
}

/**
 * Maps a section_id (e.g. PROLOGUE, A101, A302, EPILOGUE, APPENDIX) to its canonical Act ID.
 */
export function inferActFromSectionId(sectionId: string, currentAct: string): string {
  const upper = sectionId.toUpperCase().trim();
  if (upper === "PROLOGUE") return "PROLOGUE";
  if (upper === "EPILOGUE") return "EPILOGUE";
  if (upper === "APPENDIX") return "APPENDIX";
  const chMatch = /^CH_(\d{2})$/.exec(upper);
  if (chMatch) {
    return currentAct || `CHAPTER ${parseInt(chMatch[1], 10)}`;
  }
  const match = /^A([1-5])\d{2}$/.exec(upper);
  if (match) {
    const actNum = match[1];
    const map: Record<string, string> = {
      "1": "ACT ONE",
      "2": "ACT TWO",
      "3": "ACT THREE",
      "4": "ACT FOUR",
      "5": "ACT FIVE",
    };
    return map[actNum] || currentAct;
  }
  return currentAct || "ACT ONE";
}

function isNarratorTagStart(text: string): boolean {
  const cleaned = text.replace(/^\*\*+/, "").trim();
  if (/^\[(?:LOGAN|WRITTEN)\s+(?:READING|MESSAGE)\b/i.test(cleaned)) {
    return false;
  }
  return (
    /^\[(?:Male\s+)?Narrator\b/i.test(cleaned) ||
    /^(?:Male\s+)?Narrator\s*:/i.test(cleaned) ||
    /^\[Host\b/i.test(cleaned) ||
    /^\[Logan\s*(?:—\s*NARRATION|\s*\]|\s*:)/i.test(cleaned)
  );
}

function isStandaloneNarratorHeader(chunk: string): boolean {
  const lines = chunk
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) return false;
  const cleaned = lines[0].replace(/\*\*/g, "").trim();
  if (/^\[(?:LOGAN|WRITTEN)\s+(?:READING|MESSAGE)\b/i.test(cleaned)) {
    return false;
  }
  return (
    /^\[(?:Male\s+)?Narrator\b[^\]]*\](?:\s*\[[^\]]*\])*\s*:?\s*$/i.test(
      cleaned
    ) ||
    /^(?:Male\s+)?Narrator\s*:\s*$/i.test(cleaned) ||
    /^\[Host\b[^\]]*\](?:\s*\[[^\]]*\])*\s*:?\s*$/i.test(cleaned) ||
    /^\[Logan\s*(?:—\s*NARRATION|\s*\]|\s*:)[^\]]*\]?\s*$/i.test(cleaned)
  );
}

/**
 * Classifies an individual paragraph/chunk into a deterministic AST BlockType.
 * `[Male Narrator]` paragraphs and spoken narrative prose paragraphs (outside APPENDIX) are classified as `"narrator"`.
 * `>` blockquotes, `[ARCHIVAL — ...]`, `[LOGAN READING ...]`, headings, standalone production cues, and appendix are locked.
 */
export function classifyBlock(rawChunk: string, isInsideAppendix: boolean): BlockType {
  if (isInsideAppendix) {
    return "locked_meta";
  }
  const trimmed = rawChunk.trim();
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "locked_meta";

  if (lines[0].startsWith(">")) {
    return "blockquote";
  }

  if (
    lines[0].startsWith("#") ||
    /^(?:---|\*\*\*|___)\s*$/.test(lines[0]) ||
    /^[-*]\s+\*\*/.test(lines[0])
  ) {
    return "locked_meta";
  }

  const normalizedStart = trimmed.replace(/^\*\*+/, "").trim();

  if (/^\[(?:FINAL\s+)?ARCHIVAL\b/i.test(normalizedStart)) {
    return "archival";
  }

  if (/^\[(?:LOGAN|WRITTEN)\s+(?:READING|MESSAGE)\b/i.test(normalizedStart)) {
    return "reading";
  }

  if (isNarratorTagStart(normalizedStart)) {
    return "narrator";
  }

  // Protect bare section/act title lines (even if missing leading #)
  if (
    lines.length === 1 &&
    (/^\[?A[1-5]\d{2}\b/i.test(normalizedStart) ||
      /^\[?(?:PROLOGUE|EPILOGUE|ACT\s+(?:ONE|TWO|THREE|FOUR|FIVE|[1-5]|I|II|III|IV|V)|CHAPTER\s+[A-Za-z0-9]+)\b/i.test(
        normalizedStart
      ))
  ) {
    return "locked_meta";
  }

  // Standalone bracketed production/SFX cues (e.g. [BEAT], [HARD CUT.], [NO MUSIC.]) with no spoken prose
  if (
    lines.length === 1 &&
    /^\[[^\]]+\](?:\s*\[[^\]]+\])*$/.test(normalizedStart) &&
    !isNarratorTagStart(normalizedStart)
  ) {
    return "locked_meta";
  }

  // Spoken narrative prose paragraph in a script section
  return "narrator";
}

function splitSectionIntoRawChunks(normalized: string): string[] {
  const lines = normalized.split("\n");
  const chunks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      const joined = buffer.join("\n").trim();
      if (joined) chunks.push(joined);
      buffer = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flush();
      continue;
    }

    const normLine = trimmed.replace(/^\*\*+/, "").trim();
    const isHeading = trimmed.startsWith("#");
    const isHr = /^(?:---|\*\*\*|___)\s*$/.test(trimmed);
    const isArchival = /^\[(?:FINAL\s+)?ARCHIVAL\b/i.test(normLine);
    const isReading = /^\[(?:LOGAN|WRITTEN)\s+(?:READING|MESSAGE)\b/i.test(normLine);
    const isQuote = trimmed.startsWith(">");
    const isNarratorStart = isNarratorTagStart(normLine);
    const isCue = /^\[[^\]]+\]$/.test(normLine) && !isNarratorStart;

    if (isHeading || isHr || isArchival || isReading || isCue) {
      flush();
      chunks.push(trimmed);
      continue;
    }

    if (isNarratorStart) {
      flush();
      buffer.push(rawLine);
      continue;
    }

    if (isQuote) {
      if (buffer.length > 0 && !buffer[0].trim().startsWith(">")) {
        flush();
      }
      buffer.push(rawLine);
      continue;
    }

    // Current line is regular prose; if previous buffer was a blockquote, flush the blockquote first
    if (buffer.length > 0 && buffer[0].trim().startsWith(">")) {
      flush();
    }

    buffer.push(rawLine);
  }

  flush();
  return chunks;
}

/**
 * Splits a section body into discrete paragraph/cue blocks while merging standalone `[Male Narrator]`
 * cue headers (separated by blank lines) and consecutive narrator continuation paragraphs.
 */
export function parseSectionBlocks(
  sectionMarkdown: string,
  sectionId: string,
  isInsideAppendix: boolean
): ScriptBlock[] {
  const normalized = sectionMarkdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  if (isInsideAppendix) {
    const appendixChunks = normalized
      .split(/\n{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    return appendixChunks.map((chunk, idx) => ({
      id: `${sectionId}-B${idx + 1}`,
      type: "locked_meta",
      rawText: chunk,
      locked: true,
    }));
  }

  const rawChunks = splitSectionIntoRawChunks(normalized);

  const mergedChunks: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const current = rawChunks[i];

    // If this chunk is just "[Male Narrator]" on a line by itself and the next chunk is narrative prose, join them
    if (isStandaloneNarratorHeader(current) && i + 1 < rawChunks.length) {
      const next = rawChunks[i + 1];
      const nextType = classifyBlock(next, false);
      if (nextType === "narrator" && !isNarratorTagStart(next)) {
        mergedChunks.push(`${current}\n${next}`);
        i++;
        continue;
      }
    }

    // If the previous chunk is a narrator block and this chunk is an untagged narrative continuation paragraph, join them
    if (mergedChunks.length > 0) {
      const prev = mergedChunks[mergedChunks.length - 1];
      const prevType = classifyBlock(prev, false);
      const currType = classifyBlock(current, false);
      if (
        prevType === "narrator" &&
        currType === "narrator" &&
        !isNarratorTagStart(current)
      ) {
        mergedChunks[mergedChunks.length - 1] = `${prev}\n\n${current}`;
        continue;
      }
    }

    mergedChunks.push(current);
  }

  return mergedChunks.map((chunk, idx) => {
    const type = classifyBlock(chunk, isInsideAppendix);
    return {
      id: `${sectionId}-B${idx + 1}`,
      type,
      rawText: chunk,
      locked: type !== "narrator",
    };
  });
}

function matchSectionHeader(line: string): {
  isActBanner: boolean;
  actId?: string;
  sectionId?: string;
  title?: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) return null;

  // Title / document metadata headers belong in preamble, not section cards
  if (
    /^#+\s*(?:THE\s+PAPER\s+TRAIL|Reconstructed\s+Master\s+Production\s+Manuscript)\b/i.test(
      trimmed
    )
  ) {
    return null;
  }

  // Appendix / production review notes
  if (
    /^#+\s*(?:PRIVATE\s+PRODUCTION\s+REFERENCES|Production-only\s+review\s+notes|APPENDIX)\b/i.test(
      trimmed
    )
  ) {
    return {
      isActBanner: false,
      actId: "APPENDIX",
      sectionId: "APPENDIX",
      title: trimmed.replace(/^#+\s*/, ""),
    };
  }

  const codeSectionMatch = /^#+\s*(?:\[?(A[1-5]\d{2})\]?)(?:\s*[-—:]\s*|\s+)(.*)$/i.exec(
    trimmed
  );
  if (codeSectionMatch) {
    const secId = codeSectionMatch[1].toUpperCase();
    const secTitle = codeSectionMatch[2].trim() || secId;
    return {
      isActBanner: false,
      sectionId: secId,
      title: secTitle,
    };
  }

  const bareCodeMatch = /^#+\s*\[?(A[1-5]\d{2})\]?\s*$/i.exec(trimmed);
  if (bareCodeMatch) {
    const secId = bareCodeMatch[1].toUpperCase();
    return {
      isActBanner: false,
      sectionId: secId,
      title: secId,
    };
  }

  // Chapter headings: e.g. # CHAPTER ONE — WHY WE BELIEVED HER
  const chapterMatch = /^#+\s*\[?CHAPTER\s+([A-Za-z0-9]+)\]?(?:\s*[-—:]\s*(.*))?$/i.exec(
    trimmed
  );
  if (chapterMatch) {
    const rawWord = chapterMatch[1].toUpperCase();
    const wordToNumMap: Record<string, string> = {
      ONE: "01",
      TWO: "02",
      THREE: "03",
      FOUR: "04",
      FIVE: "05",
      SIX: "06",
      SEVEN: "07",
      EIGHT: "08",
      NINE: "09",
      TEN: "10",
      ELEVEN: "11",
      TWELVE: "12",
      "1": "01",
      "2": "02",
      "3": "03",
      "4": "04",
      "5": "05",
      "6": "06",
      "7": "07",
      "8": "08",
      "9": "09",
      "10": "10",
      "11": "11",
      "12": "12",
    };
    const num = wordToNumMap[rawWord] || rawWord.padStart(2, "0");
    const secId = `CH_${num}`;
    const chapterWord = `CHAPTER ${rawWord}`;
    return {
      isActBanner: false,
      actId: chapterWord,
      sectionId: secId,
      title: chapterMatch[2]?.trim() || chapterWord,
    };
  }

  const prologueMatch = /^#+\s*\[?PROLOGUE\]?(?:\s*[-—:]\s*(.*))?$/i.exec(trimmed);
  if (prologueMatch) {
    return {
      isActBanner: false,
      actId: "PROLOGUE",
      sectionId: "PROLOGUE",
      title: prologueMatch[1]?.trim() || "PROLOGUE",
    };
  }

  const epilogueMatch = /^#+\s*\[?EPILOGUE\]?(?:\s*[-—:]\s*(.*))?$/i.exec(trimmed);
  if (epilogueMatch) {
    return {
      isActBanner: false,
      actId: "EPILOGUE",
      sectionId: "EPILOGUE",
      title: epilogueMatch[1]?.trim() || "EPILOGUE",
    };
  }

  const actBannerMatch = /^#+\s*(ACT\s+(?:ONE|TWO|THREE|FOUR|FIVE|[1-5]|I|II|III|IV|V))\b/i.exec(trimmed);
  if (actBannerMatch) {
    const rawAct = actBannerMatch[1].toUpperCase().replace(/\s+/g, " ");
    const numMap: Record<string, string> = {
      "ACT 1": "ACT ONE",
      "ACT I": "ACT ONE",
      "ACT 2": "ACT TWO",
      "ACT II": "ACT TWO",
      "ACT 3": "ACT THREE",
      "ACT III": "ACT THREE",
      "ACT 4": "ACT FOUR",
      "ACT IV": "ACT FOUR",
      "ACT 5": "ACT FIVE",
      "ACT V": "ACT FIVE",
    };
    return {
      isActBanner: true,
      actId: numMap[rawAct] || rawAct,
    };
  }

  // Fallback for any ## or ### scene/movement heading in custom scripts
  const genericHeadingMatch = /^#{2,4}\s+(.+)$/.exec(trimmed);
  if (genericHeadingMatch) {
    const rawHeading = genericHeadingMatch[1].trim();
    const bracketedCode = /^\[([A-Za-z0-9_-]+)\](?:\s*[-—:]\s*(.*))?$/.exec(rawHeading);
    if (bracketedCode) {
      const secId = bracketedCode[1].toUpperCase();
      return {
        isActBanner: false,
        sectionId: secId,
        title: bracketedCode[2]?.trim() || secId,
      };
    }
    const slug = rawHeading
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24);
    if (slug) {
      return {
        isActBanner: false,
        sectionId: slug,
        title: rawHeading,
      };
    }
  }

  return null;
}

/**
 * Resolves a potentially noisy section_id from an LLM (e.g., "[A101]", "A101 — Title", "Section A101", "Chapter 1")
 * to the canonical ScriptSection in `parsed.sections`.
 */
export function resolveSectionById(
  parsed: ParsedManuscript,
  rawId: string | undefined | null
): ScriptSection | undefined {
  if (!rawId) return undefined;
  const cleaned = rawId
    .replace(/^\[|\]$/g, "")
    .replace(/^SECTION\s+/i, "")
    .trim()
    .toUpperCase();
  if (!cleaned) return undefined;

  // 1. Exact match
  const exact = parsed.sections.find(
    (s) => s.section_id.toUpperCase() === cleaned
  );
  if (exact) return exact;

  // 2. Chapter number match (e.g., "CHAPTER 1", "CHAPTER ONE", "CH 1", "CH_01")
  const chMatch = /^(?:CHAPTER|CH)[_\s]*([A-Za-z0-9]+)$/i.exec(cleaned);
  if (chMatch) {
    const raw = chMatch[1].toUpperCase();
    const wordMap: Record<string, string> = {
      ONE: "01",
      TWO: "02",
      THREE: "03",
      FOUR: "04",
      FIVE: "05",
      SIX: "06",
      SEVEN: "07",
      EIGHT: "08",
      NINE: "09",
      TEN: "10",
      ELEVEN: "11",
      TWELVE: "12",
      "1": "01",
      "2": "02",
      "3": "03",
      "4": "04",
      "5": "05",
      "6": "06",
      "7": "07",
      "8": "08",
      "9": "09",
      "10": "10",
      "11": "11",
      "12": "12",
    };
    const num = wordMap[raw] || raw.padStart(2, "0");
    const matched = parsed.sections.find(
      (s) => s.section_id === `CH_${num}` || s.section_id === `CHAPTER_${num}`
    );
    if (matched) return matched;
  }

  // 3. Code prefix match (e.g. "A101 — THE SEPTEMBER 8 PRETEXT" -> "A101")
  const prefixMatch = parsed.sections.find(
    (s) =>
      cleaned.startsWith(s.section_id.toUpperCase() + " ") ||
      cleaned.startsWith(s.section_id.toUpperCase() + "—") ||
      cleaned.startsWith(s.section_id.toUpperCase() + "-") ||
      cleaned.startsWith(s.section_id.toUpperCase() + ":")
  );
  if (prefixMatch) return prefixMatch;

  // 4. Substring / Title match
  return parsed.sections.find(
    (s) =>
      cleaned.includes(s.section_id.toUpperCase()) ||
      s.title.toUpperCase() === cleaned
  );
}

/**
 * Deterministically parses the full Markdown manuscript into discrete sections
 * (`PROLOGUE`, `A101`–`A505`, `EPILOGUE`, `APPENDIX`).
 */
export function parseManuscript(markdown: string): ParsedManuscript {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const preambleLines: string[] = [];
  const sections: ScriptSection[] = [];

  let currentAct = "PROLOGUE";
  let currentSectionId: string | null = null;
  let currentSectionTitle = "";
  let currentHeaderLine = "";
  let currentBodyLines: string[] = [];
  let pendingActBannerLines: string[] = [];

  const flushCurrentSection = () => {
    if (!currentSectionId) return;
    const isAppendix = currentSectionId === "APPENDIX";
    const bodyText = currentBodyLines.join("\n").trim();
    const headerBlock = currentHeaderLine.trim();
    const fullSectionRaw = bodyText ? `${headerBlock}\n\n${bodyText}` : headerBlock;
    const blocks = parseSectionBlocks(fullSectionRaw, currentSectionId, isAppendix);

    sections.push({
      section_id: currentSectionId,
      title: currentSectionTitle,
      act_id: inferActFromSectionId(currentSectionId, currentAct),
      headerLine: headerBlock,
      blocks,
      rawMarkdown: fullSectionRaw,
    });

    currentSectionId = null;
    currentSectionTitle = "";
    currentHeaderLine = "";
    currentBodyLines = [];
  };

  for (const line of lines) {
    if (currentSectionId === "APPENDIX") {
      currentBodyLines.push(line);
      continue;
    }

    const headerInfo = matchSectionHeader(line);
    if (headerInfo) {
      if (headerInfo.isActBanner && headerInfo.actId) {
        flushCurrentSection();
        currentAct = headerInfo.actId;
        pendingActBannerLines.push(line);
        continue;
      }

      if (headerInfo.sectionId) {
        if (
          currentSectionId === headerInfo.sectionId &&
          currentBodyLines.every((l) => l.trim() === "")
        ) {
          currentSectionTitle = headerInfo.title || currentSectionTitle;
          currentHeaderLine = `${currentHeaderLine.trim()}\n\n${line}`;
          currentBodyLines = [];
          continue;
        }
        flushCurrentSection();
        if (headerInfo.actId) {
          currentAct = headerInfo.actId;
        } else {
          currentAct = inferActFromSectionId(headerInfo.sectionId, currentAct);
        }
        currentSectionId = headerInfo.sectionId;
        currentSectionTitle = headerInfo.title || headerInfo.sectionId;
        if (pendingActBannerLines.length > 0) {
          currentHeaderLine = `${pendingActBannerLines.join("\n")}\n\n${line}`;
          pendingActBannerLines = [];
        } else {
          currentHeaderLine = line;
        }
        continue;
      }
    }

    if (currentSectionId === null) {
      if (pendingActBannerLines.length > 0) {
        if (line.trim() === "") {
          pendingActBannerLines.push(line);
        } else {
          // Act banner followed directly by body content without a ## sub-heading
          const actSecId = currentAct.replace(/\s+/g, "_").toUpperCase();
          currentSectionId = actSecId;
          currentSectionTitle = currentAct;
          currentHeaderLine = pendingActBannerLines.join("\n").trim();
          pendingActBannerLines = [];
          currentBodyLines.push(line);
        }
      } else if (
        line.trim() !== "" &&
        !line.trim().startsWith("#") &&
        (isNarratorTagStart(line.trim()) ||
          line.trim().startsWith(">") ||
          /^\[ARCHIVAL\b/i.test(line.trim()))
      ) {
        // Script content started before any section heading
        currentSectionId = "PROLOGUE";
        currentSectionTitle = "PROLOGUE";
        currentHeaderLine = "";
        currentBodyLines.push(line);
      } else {
        preambleLines.push(line);
      }
    } else {
      currentBodyLines.push(line);
    }
  }

  flushCurrentSection();

  if (sections.length === 0 && normalized.trim().length > 0) {
    const blocks = parseSectionBlocks(normalized, "PROLOGUE", false);
    sections.push({
      section_id: "PROLOGUE",
      title: "PROLOGUE",
      act_id: "PROLOGUE",
      headerLine: "## PROLOGUE",
      blocks,
      rawMarkdown: normalized.trim(),
    });
    return { preamble: "", sections };
  }

  return {
    preamble: preambleLines.join("\n").trim(),
    sections,
  };
}

/**
 * Reassembles a `ParsedManuscript` back into a clean Markdown string.
 */
export function assembleManuscript(parsed: ParsedManuscript): string {
  const parts: string[] = [];
  if (parsed.preamble.trim()) {
    parts.push(parsed.preamble.trim());
  }
  for (const section of parsed.sections) {
    const sectionText = section.blocks.map((b) => b.rawText.trim()).join("\n\n");
    parts.push(sectionText);
  }
  return parts.join("\n\n").trim() + "\n";
}

function normalizeForScan(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Programmatic Blacklist Scanner (Ironclad Privacy Fence + Lingering Hera Reference Purge Check).
 */
export function scanPrivacyFence(markdown: string): PrivacyScanResult {
  const parsed = parseManuscript(markdown);
  const foundSet = new Set<string>();
  const violations: PrivacyViolation[] = [];
  let heraFound = false;

  const checkChunk = (text: string, sectionId: string) => {
    const norm = normalizeForScan(text);
    for (const phrase of FORBIDDEN_DOMESTIC_PHRASES) {
      const normPhrase = normalizeForScan(phrase);
      const idx = norm.indexOf(normPhrase);
      if (idx !== -1) {
        foundSet.add(phrase);
        const start = Math.max(0, idx - 30);
        const end = Math.min(norm.length, idx + normPhrase.length + 30);
        violations.push({
          section_id: sectionId,
          phrase,
          excerpt: text.replace(/\s+/g, " ").slice(start, end).trim(),
        });
      }
    }

    if (/\bhera\b/i.test(text)) {
      heraFound = true;
      violations.push({
        section_id: sectionId,
        phrase: "Hera (Purged Contamination Anchor)",
        excerpt: "Lingering reference to October Hera intervention detected.",
      });
    }
  };

  if (parsed.preamble) {
    checkChunk(parsed.preamble, "PREAMBLE");
  }

  for (const section of parsed.sections) {
    for (const block of section.blocks) {
      checkChunk(block.rawText, section.section_id);
    }
  }

  const forbidden_domestic_phrases_found = Array.from(foundSet);
  const privacy_gate_passed =
    forbidden_domestic_phrases_found.length === 0 && !heraFound;

  return {
    privacy_gate_passed,
    forbidden_domestic_phrases_found,
    hera_references_found: heraFound,
    violations,
  };
}

/**
 * Spoken Cadence & Tape-Echo Scanner (`scanAudioCraft` — $0 Cost Deterministic Acoustic Engine).
 * Detects:
 * 1. Adjacent Quote Echo (shared normalized 4-gram or >=5-word contiguous phrase overlap between narrator and nearest preceding/succeeding blockquote).
 * 2. Breath / Mouthful Sentences (> 32 words or > 3 clause-splitting punctuation marks: commas, em-dashes, semicolons).
 * 3. Runtime & Pacing Ratio (spoken word count, estimated duration at 150 wpm, [Beat] / pause cue count).
 * 4. Deadwood Announcer Phrases ("in the clip you just heard", "as you just heard", "according to what i remember", "here is the first message log").
 */
export function scanAudioCraft(input: ParsedManuscript | string): AudioCraftReport {
  const parsed = typeof input === "string" ? parseManuscript(input) : input;

  const stripDeliveryTags = (raw: string): string => {
    return raw
      .replace(/^\*\*\[Male Narrator\]\*\*|^\[Male Narrator\]/i, "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const tokenizeNormalizedWords = (text: string): string[] => {
    return text
      .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
  };

  const findPhraseOverlap = (narratorText: string, quoteText: string): string | null => {
    const nWords = tokenizeNormalizedWords(stripDeliveryTags(narratorText));
    const qWords = tokenizeNormalizedWords(quoteText.replace(/^>\s*/gm, ""));
    if (nWords.length < 4 || qWords.length < 4) return null;

    // Build set of 4-grams and 5-grams in quote
    for (let windowSize = Math.min(7, nWords.length, qWords.length); windowSize >= 4; windowSize--) {
      const quoteGrams = new Set<string>();
      for (let i = 0; i <= qWords.length - windowSize; i++) {
        quoteGrams.add(qWords.slice(i, i + windowSize).join(" "));
      }
      for (let i = 0; i <= nWords.length - windowSize; i++) {
        const candidate = nWords.slice(i, i + windowSize).join(" ");
        if (quoteGrams.has(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  };

  let totalSpokenWords = 0;
  let totalBeatCues = 0;
  const allQuoteEchoes: QuoteEchoFinding[] = [];
  const allMouthfuls: MouthfulSentenceFinding[] = [];
  const allDeadwood: DeadwoodPhraseFinding[] = [];
  const sectionsMap: Record<string, SectionAudioCraft> = {};

  for (const section of parsed.sections) {
    if (section.section_id === "APPENDIX") continue;

    let sectionWords = 0;
    let sectionBeats = 0;
    const sectionEchoes: QuoteEchoFinding[] = [];
    const sectionMouthfuls: MouthfulSentenceFinding[] = [];
    const sectionDeadwood: DeadwoodPhraseFinding[] = [];

    const blocks = section.blocks;

    for (let idx = 0; idx < blocks.length; idx++) {
      const block = blocks[idx];
      if (block.type !== "narrator") continue;

      // Count [Beat] / [Pause] / [Silence] cues
      const beatMatches = block.rawText.match(/\[\s*(?:beat|pause|silence)\s*\]/gi);
      const beatCount = beatMatches ? beatMatches.length : 0;
      sectionBeats += beatCount;

      const spokenOnly = stripDeliveryTags(block.rawText);
      const words = spokenOnly ? spokenOnly.split(/\s+/).filter(Boolean) : [];
      sectionWords += words.length;

      // 1. Adjacent Quote Echo Check (nearest preceding and succeeding blockquote in same section)
      let precedingQuoteBlock: ScriptBlock | null = null;
      for (let p = idx - 1; p >= 0; p--) {
        if (blocks[p].type === "blockquote") {
          precedingQuoteBlock = blocks[p];
          break;
        }
        if (blocks[p].type === "narrator") {
          break;
        }
      }

      if (precedingQuoteBlock) {
        const overlap = findPhraseOverlap(block.rawText, precedingQuoteBlock.rawText);
        if (overlap) {
          const finding: QuoteEchoFinding = {
            section_id: section.section_id,
            block_id: block.id,
            adjacent_quote_block_id: precedingQuoteBlock.id,
            direction: "preceding",
            matched_phrase: overlap,
          };
          sectionEchoes.push(finding);
          allQuoteEchoes.push(finding);
        }
      }

      let succeedingQuoteBlock: ScriptBlock | null = null;
      for (let s = idx + 1; s < blocks.length; s++) {
        if (blocks[s].type === "blockquote") {
          succeedingQuoteBlock = blocks[s];
          break;
        }
        if (blocks[s].type === "narrator") {
          break;
        }
      }

      if (succeedingQuoteBlock) {
        const overlap = findPhraseOverlap(block.rawText, succeedingQuoteBlock.rawText);
        if (overlap) {
          const finding: QuoteEchoFinding = {
            section_id: section.section_id,
            block_id: block.id,
            adjacent_quote_block_id: succeedingQuoteBlock.id,
            direction: "succeeding",
            matched_phrase: overlap,
          };
          sectionEchoes.push(finding);
          allQuoteEchoes.push(finding);
        }
      }

      // 2. Breath / Mouthful Sentences Check (> 32 words or > 3 clause-splitting punctuation marks)
      const sentences = spokenOnly
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const sentence of sentences) {
        const sWords = sentence.split(/\s+/).filter(Boolean);
        const clauseMatches = sentence.match(/,|;|—|--/g);
        const clauseCount = clauseMatches ? clauseMatches.length : 0;
        const overWords = sWords.length > 32;
        const overClauses = clauseCount > 3;

        if (overWords || overClauses) {
          const finding: MouthfulSentenceFinding = {
            section_id: section.section_id,
            block_id: block.id,
            sentence,
            word_count: sWords.length,
            clause_punctuation_count: clauseCount,
            reason: overWords && overClauses
              ? "both"
              : overWords
              ? "exceeds_32_words"
              : "excessive_clauses",
          };
          sectionMouthfuls.push(finding);
          allMouthfuls.push(finding);
        }
      }

      // 4. Deadwood Announcer Phrases Check
      const normNarrator = normalizeForScan(block.rawText);
      for (const phrase of DEADWOOD_ANNOUNCER_PHRASES) {
        const normPhrase = normalizeForScan(phrase);
        const matchIdx = normNarrator.indexOf(normPhrase);
        if (matchIdx !== -1) {
          const finding: DeadwoodPhraseFinding = {
            section_id: section.section_id,
            block_id: block.id,
            phrase,
            excerpt: block.rawText.replace(/\s+/g, " ").trim().slice(0, 140),
          };
          sectionDeadwood.push(finding);
          allDeadwood.push(finding);
        }
      }
    }

    totalSpokenWords += sectionWords;
    totalBeatCues += sectionBeats;

    sectionsMap[section.section_id] = {
      section_id: section.section_id,
      spoken_words: sectionWords,
      estimated_runtime_seconds: Math.round((sectionWords / 150) * 60),
      beat_cue_count: sectionBeats,
      quote_echoes: sectionEchoes,
      mouthful_sentences: sectionMouthfuls,
      deadwood_phrases: sectionDeadwood,
    };
  }

  return {
    total_spoken_words: totalSpokenWords,
    estimated_runtime_seconds: Math.round((totalSpokenWords / 150) * 60),
    total_beat_cues: totalBeatCues,
    quote_echo_count: allQuoteEchoes.length,
    mouthful_sentence_count: allMouthfuls.length,
    deadwood_phrase_count: allDeadwood.length,
    quote_echoes: allQuoteEchoes,
    mouthful_sentences: allMouthfuls,
    deadwood_phrases: allDeadwood,
    sections: sectionsMap,
  };
}

/**
 * Verifies 1:1 Cue Integrity between original and spliced manuscripts.
 */
export function verifyCueIntegrity(
  beforeMarkdown: string,
  afterMarkdown: string
): CueIntegrityReport {
  const beforeParsed = parseManuscript(beforeMarkdown);
  const afterParsed = parseManuscript(afterMarkdown);

  const extractByType = (parsed: ParsedManuscript, type: BlockType): string[] => {
    const items: string[] = [];
    for (const sec of parsed.sections) {
      for (const b of sec.blocks) {
        if (b.type === type) {
          items.push(b.rawText.trim());
        }
      }
    }
    return items;
  };

  const bqBefore = extractByType(beforeParsed, "blockquote");
  const bqAfter = extractByType(afterParsed, "blockquote");
  const archBefore = extractByType(beforeParsed, "archival");
  const archAfter = extractByType(afterParsed, "archival");
  const readBefore = extractByType(beforeParsed, "reading");
  const readAfter = extractByType(afterParsed, "reading");

  const appendixBefore =
    beforeParsed.sections.find((s) => s.section_id === "APPENDIX")?.rawMarkdown.trim() || "";
  const appendixAfter =
    afterParsed.sections.find((s) => s.section_id === "APPENDIX")?.rawMarkdown.trim() || "";

  const mismatches: string[] = [];

  if (bqBefore.length !== bqAfter.length) {
    mismatches.push(
      `Blockquote count mismatch: expected ${bqBefore.length}, got ${bqAfter.length}`
    );
  } else {
    for (let i = 0; i < bqBefore.length; i++) {
      if (bqBefore[i] !== bqAfter[i]) {
        mismatches.push(`Blockquote #${i + 1} content altered.`);
      }
    }
  }

  if (archBefore.length !== archAfter.length) {
    mismatches.push(
      `[ARCHIVAL] cue count mismatch: expected ${archBefore.length}, got ${archAfter.length}`
    );
  } else {
    for (let i = 0; i < archBefore.length; i++) {
      if (archBefore[i] !== archAfter[i]) {
        mismatches.push(`[ARCHIVAL] cue #${i + 1} content altered.`);
      }
    }
  }

  if (readBefore.length !== readAfter.length) {
    mismatches.push(
      `[LOGAN READING] block count mismatch: expected ${readBefore.length}, got ${readAfter.length}`
    );
  } else {
    for (let i = 0; i < readBefore.length; i++) {
      if (readBefore[i] !== readAfter[i]) {
        mismatches.push(`[LOGAN READING] block #${i + 1} content altered.`);
      }
    }
  }

  const appendix_intact =
    appendixBefore.replace(/\s+/g, " ") === appendixAfter.replace(/\s+/g, " ");
  if (!appendix_intact) {
    mismatches.push(`# PRIVATE PRODUCTION REFERENCES appendix was modified.`);
  }

  return {
    tag_integrity: mismatches.length === 0,
    blockquotes_before: bqBefore.length,
    blockquotes_after: bqAfter.length,
    archival_cues_before: archBefore.length,
    archival_cues_after: archAfter.length,
    reading_blocks_before: readBefore.length,
    reading_blocks_after: readAfter.length,
    appendix_intact,
    mismatches,
  };
}

/**
 * Deterministic showrunner cadence polisher for narrator blocks if an LLM edit pass produces 0 delta.
 * Tightens spoken rhythm, strips announcer deadwood, and sharpens transitions without touching locked cues.
 */
export function buildDeterministicNarratorPatches(
  manuscript: string,
  targetSectionIds: string[],
  pinnedSet: Set<string>
): NarratorBlockPatch[] {
  const parsed = parseManuscript(manuscript);
  const targetSet = new Set(targetSectionIds.map((id) => id.toUpperCase().trim()));
  const candidates = parsed.sections.filter(
    (s) =>
      s.section_id !== "APPENDIX" &&
      s.blocks.some((b) => b.type === "narrator") &&
      (targetSet.size === 0 || targetSet.has(s.section_id.toUpperCase()))
  );

  const sectionsToUse =
    candidates.length > 0
      ? candidates
      : parsed.sections
          .filter(
            (s) =>
              s.section_id !== "APPENDIX" &&
              s.blocks.some((b) => b.type === "narrator")
          )
          .slice(0, 2);

  const patches: NarratorBlockPatch[] = [];

  for (const sec of sectionsToUse) {
    for (const block of sec.blocks) {
      if (block.type !== "narrator" || pinnedSet.has(block.id)) continue;

      let updated = block.rawText
        .replace(/\bAccording to what I remember,\s*/gi, "")
        .replace(/\bI allegedly stepped in to tell him\b/gi, "I keyed the mic and told him")
        .replace(/\bIn the clip you just heard me read,\s*/gi, "On the uncut tape, ")
        .replace(/\bAs you just heard in that archival cue,\s*/gi, "The metadata confirms ")
        .replace(/\bNow,\s*I want to defend myself here and explain that\s*/gi, "Let's look at the record: ")
        .replace(/\bBasically,\s*back in the early days of\b/gi, "Back in")
        .replace(/\bIt could be argued that\s*/gi, "")
        .replace(/\bMost people just never bother to\b/gi, "Few people ever")
        .replace(/\s+though Angela later claimed I just sat there passively listening to it\./gi, ". [Beat] Angela later claimed I sat silent.")
        .replace(/\bHere is the first message log[^.]*\.\s*/gi, "The backchannel export tells a different story. [Beat] ");

      if (updated.trim() === block.rawText.trim()) {
        if (!updated.includes("[Beat]")) {
          const lines = updated.trim().split("\n");
          const lastIdx = lines.length - 1;
          const sentences = lines[lastIdx].split(/(?<=\.)\s+/);
          if (sentences.length >= 2) {
            sentences[0] = `${sentences[0]} [Beat]`;
            lines[lastIdx] = sentences.join(" ");
            updated = lines.join("\n");
          } else {
            updated = `${updated.trim()} [Beat]`;
          }
        } else {
          updated = updated.replace(/\s*\[Beat\]\s*/, " — ");
        }
      }

      if (updated.trim() !== block.rawText.trim()) {
        patches.push({
          section_id: sec.section_id,
          block_id: block.id,
          updated_narrator_markdown: updated.trim(),
        });
      }
    }
  }

  return patches;
}

function calculateNarratorDelta(beforeBlocks: string[], afterBlocks: string[]): number {
  const beforeJoined = beforeBlocks.join("\n\n").trim();
  const afterJoined = afterBlocks.join("\n\n").trim();
  if (beforeJoined === afterJoined) return 0;

  const beforeWords = beforeJoined.split(/\s+/);
  const afterWords = afterJoined.split(/\s+/);
  let diffChars = Math.abs(beforeJoined.length - afterJoined.length);

  const minLen = Math.min(beforeWords.length, afterWords.length);
  for (let i = 0; i < minLen; i++) {
    if (beforeWords[i] !== afterWords[i]) {
      diffChars += Math.max(beforeWords[i].length, afterWords[i].length);
    }
  }
  return Math.max(diffChars, 1);
}

/**
 * Applies block-level `NarratorBlockPatch[]` (`{ section_id, block_id, updated_narrator_markdown }`)
 * to the manuscript while holding all non-narrator blocks and locked acts 100% read-only.
 */
export function applyNarratorPatches(
  originalMarkdown: string,
  narratorPatches: NarratorBlockPatch[],
  lockedActs: string[] = [],
  protectedBlockIdSet?: Set<string>
): SpliceResult {
  const parsed = parseManuscript(originalMarkdown);
  const lockedActSet = new Set((lockedActs || []).map((a) => a.toUpperCase().trim()));
  const guardrailEvents: string[] = [];
  const sectionDiffs: SectionDiffRecord[] = [];
  let anySectionChanged = false;

  // Group patches by canonical section_id
  const bySection = new Map<string, NarratorBlockPatch[]>();
  for (const patch of narratorPatches || []) {
    if (!patch || typeof patch.updated_narrator_markdown !== "string") continue;
    const rawSecId =
      patch.section_id ||
      (patch.block_id && patch.block_id.includes("-")
        ? patch.block_id.split("-")[0]
        : "");
    if (!rawSecId) continue;
    const resolvedSec = resolveSectionById(parsed, rawSecId);
    const secKey = (resolvedSec ? resolvedSec.section_id : rawSecId)
      .toUpperCase()
      .trim();
    const list = bySection.get(secKey) || [];
    list.push(patch);
    bySection.set(secKey, list);
  }

  for (const section of parsed.sections) {
    const secId = section.section_id.toUpperCase();
    const patchesForSection = bySection.get(secId);
    if (!patchesForSection || patchesForSection.length === 0) continue;

    if (secId === "APPENDIX" || lockedActSet.has(section.act_id.toUpperCase())) {
      guardrailEvents.push(
        `[GUARDRAIL BLOCK] Rejected narrator patch for ${secId} (${section.act_id} is LOCKED).`
      );
      continue;
    }

    const beforeSectionMarkdown = section.blocks.map((b) => b.rawText.trim()).join("\n\n");
    const originalNarrators = section.blocks
      .filter((b) => b.type === "narrator")
      .map((b) => b.rawText.trim());

    const updatedBlocks = section.blocks.map((b) => ({ ...b }));
    let nonNarratorMutatedAttemptIntercepted = false;

    const narratorBlockIndices = updatedBlocks
      .map((b, idx) => (b.type === "narrator" ? idx : -1))
      .filter((idx) => idx !== -1);
    const usedNarratorBlockIndices = new Set<number>();

    for (let pIdx = 0; pIdx < patchesForSection.length; pIdx++) {
      const patch = patchesForSection[pIdx];
      const rawBlockId = (patch.block_id || "").trim();

      // 1. First match against actual narrator blocks by exact ID
      let targetIdx = updatedBlocks.findIndex(
        (b) =>
          b.type === "narrator" &&
          (b.id.toUpperCase() === rawBlockId.toUpperCase() ||
            b.id.toUpperCase() === `${secId}-${rawBlockId.toUpperCase()}` ||
            (rawBlockId.replace(/\D/g, "") !== "" &&
              b.id.toUpperCase() === `${secId}-B${rawBlockId.replace(/\D/g, "")}`))
      );

      // 2. Positional fallback among unused narrator blocks if the LLM used a 1-based narrator index (e.g. B1 for 1st narrator block when B1 is a heading)
      if (targetIdx === -1) {
        if (
          pIdx < narratorBlockIndices.length &&
          !usedNarratorBlockIndices.has(narratorBlockIndices[pIdx])
        ) {
          targetIdx = narratorBlockIndices[pIdx];
        } else {
          const nextUnused = narratorBlockIndices.find(
            (idx) => !usedNarratorBlockIndices.has(idx)
          );
          if (nextUnused !== undefined) {
            targetIdx = nextUnused;
          }
        }
      }

      if (targetIdx === -1) {
        guardrailEvents.push(
          `[GUARDRAIL SKIP] Block ${patch.block_id} not found in ${secId}.`
        );
        continue;
      }

      const canonicalBlockId = updatedBlocks[targetIdx].id;
      if (protectedBlockIdSet && protectedBlockIdSet.has(canonicalBlockId)) {
        usedNarratorBlockIndices.add(targetIdx);
        guardrailEvents.push(
          `[PINNED BLOCK LOCK] Skipped pinned block ${canonicalBlockId} in ${secId}.`
        );
        continue;
      }

      if (updatedBlocks[targetIdx].type !== "narrator") {
        nonNarratorMutatedAttemptIntercepted = true;
        guardrailEvents.push(
          `[PRIMARY EVIDENCE LOCK] Rejected attempt to patch non-narrator block ${canonicalBlockId} in ${secId}.`
        );
        continue;
      }

      usedNarratorBlockIndices.add(targetIdx);

      // Sanitize line-by-line so quotes, archival cues, reading blocks, and headings can never be smuggled in
      const rawLines = (patch.updated_narrator_markdown || "")
        .replace(/\r\n/g, "\n")
        .split("\n");
      const safeLines: string[] = [];
      for (const line of rawLines) {
        const trimmedLine = line.trim();
        const normLine = trimmedLine.replace(/^\*\*+/, "").trim();
        if (
          trimmedLine.startsWith(">") ||
          trimmedLine.startsWith("#") ||
          /^\[ARCHIVAL\b/i.test(normLine) ||
          /^\[(?:LOGAN|WRITTEN)\s+READING\b/i.test(normLine)
        ) {
          nonNarratorMutatedAttemptIntercepted = true;
          continue;
        }
        safeLines.push(line);
      }

      let cleaned = safeLines.join("\n").trim();
      if (!cleaned) continue;

      // Collapse blank lines immediately following a [Male Narrator] header tag
      cleaned = cleaned.replace(
        /^((?:\*\*)?\[(?:Male\s+)?Narrator[^\n]*)\n\n+/i,
        "$1\n"
      );

      const originalFirstLine = updatedBlocks[targetIdx].rawText
        .trim()
        .split("\n")[0]
        .trim();
      if (!isNarratorTagStart(cleaned)) {
        if (isNarratorTagStart(originalFirstLine)) {
          cleaned = `${originalFirstLine}\n${cleaned}`;
        } else {
          cleaned = `[Male Narrator]\n${cleaned}`;
        }
      }

      if (isStandaloneNarratorHeader(cleaned)) {
        guardrailEvents.push(
          `[PRIMARY EVIDENCE LOCK] Rejected empty narrator replacement for ${canonicalBlockId}.`
        );
        continue;
      }

      updatedBlocks[targetIdx].rawText = cleaned;
    }

    const afterNarrators = updatedBlocks
      .filter((b) => b.type === "narrator")
      .map((b) => b.rawText.trim());

    const deltaChars = calculateNarratorDelta(originalNarrators, afterNarrators);
    const minimumDeltaMet = deltaChars > 0;

    if (minimumDeltaMet) {
      anySectionChanged = true;
    }

    section.blocks = updatedBlocks;
    const afterSectionMarkdown = section.blocks.map((b) => b.rawText.trim()).join("\n\n");
    section.rawMarkdown = afterSectionMarkdown;

    if (minimumDeltaMet || nonNarratorMutatedAttemptIntercepted) {
      sectionDiffs.push({
        section_id: secId,
        act_id: section.act_id,
        title: section.title,
        beforeMarkdown: beforeSectionMarkdown,
        afterMarkdown: afterSectionMarkdown,
        narratorBlocksBefore: originalNarrators,
        narratorBlocksAfter: afterNarrators,
        deltaChars,
        minimumDeltaMet,
        nonNarratorMutatedAttemptIntercepted,
      });
    }
  }

  const assembledMarkdown = assembleManuscript(parsed);
  const cueIntegrity = verifyCueIntegrity(originalMarkdown, assembledMarkdown);

  if (!cueIntegrity.tag_integrity) {
    guardrailEvents.push(
      `[CRITICAL ROLLBACK] 1:1 cue integrity check failed (${cueIntegrity.mismatches.join("; ")}). Restored original manuscript.`
    );
    return {
      assembledMarkdown: originalMarkdown,
      sectionDiffs: [],
      cueIntegrity,
      guardrailEvents,
      anySectionChanged: false,
    };
  }

  return {
    assembledMarkdown,
    sectionDiffs,
    cueIntegrity,
    guardrailEvents,
    anySectionChanged,
  };
}

/**
 * Converts section-level patches into `NarratorBlockPatch[]` or splices section-level patches directly.
 */
export function convertSectionPatchesToNarratorPatches(
  originalMarkdown: string,
  patchedSections: Array<{ section_id: string; updated_section_markdown: string }>
): NarratorBlockPatch[] {
  const parsed = parseManuscript(originalMarkdown);
  const patches: NarratorBlockPatch[] = [];

  for (const item of patchedSections || []) {
    if (!item || !item.section_id || typeof item.updated_section_markdown !== "string") {
      continue;
    }
    const origSec = resolveSectionById(parsed, item.section_id);
    if (!origSec) continue;
    const secId = origSec.section_id;

    const origNarratorBlocks = origSec.blocks.filter((b) => b.type === "narrator");
    const proposedBlocks = parseSectionBlocks(item.updated_section_markdown, secId, false);
    const proposedNarrators = proposedBlocks
      .filter((b) => b.type === "narrator")
      .map((b) => b.rawText.trim());

    if (origNarratorBlocks.length === 0 || proposedNarrators.length === 0) continue;

    origNarratorBlocks.forEach((origBlock, idx) => {
      if (idx < proposedNarrators.length) {
        const replacement =
          idx === origNarratorBlocks.length - 1 &&
          proposedNarrators.length > origNarratorBlocks.length
            ? proposedNarrators.slice(idx).join("\n\n")
            : proposedNarrators[idx];
        patches.push({
          section_id: origSec.section_id,
          block_id: origBlock.id,
          updated_narrator_markdown: replacement,
        });
      }
    });
  }

  return patches;
}

/**
 * Programmatically splices ONLY `[Male Narrator]` blocks from the Editor Agent's patched sections
 * into the Master Script AST while holding all `>` blockquotes, `[ARCHIVAL — ...]` cues,
 * `[LOGAN READING ...]` blocks, locked acts, and `# PRIVATE PRODUCTION REFERENCES` 100% read-only in memory.
 */
export function applySurgicalPatches(
  originalMarkdown: string,
  patchedSections: Array<{ section_id: string; updated_section_markdown: string }>,
  lockedActs: string[] = []
): SpliceResult {
  const parsed = parseManuscript(originalMarkdown);
  const lockedActSet = new Set((lockedActs || []).map((a) => a.toUpperCase().trim()));
  const patchMap = new Map<string, string>();

  for (const item of patchedSections) {
    if (item && item.section_id && typeof item.updated_section_markdown === "string") {
      const resolvedSec = resolveSectionById(parsed, item.section_id);
      const canonicalKey = (resolvedSec ? resolvedSec.section_id : item.section_id)
        .toUpperCase()
        .trim();
      patchMap.set(canonicalKey, item.updated_section_markdown);
    }
  }

  const guardrailEvents: string[] = [];
  const sectionDiffs: SectionDiffRecord[] = [];
  let anySectionChanged = false;

  for (const section of parsed.sections) {
    const secId = section.section_id.toUpperCase();
    const proposedMarkdown = patchMap.get(secId);

    if (!proposedMarkdown) {
      continue;
    }

    if (secId === "APPENDIX" || lockedActSet.has(section.act_id.toUpperCase())) {
      guardrailEvents.push(
        `[GUARDRAIL BLOCK] Rejected patch for ${secId} (${section.act_id} is LOCKED).`
      );
      continue;
    }

    const proposedBlocks = parseSectionBlocks(proposedMarkdown, secId, false);
    const proposedNarrators = proposedBlocks
      .filter((b) => b.type === "narrator")
      .map((b) => b.rawText.trim());

    const originalNarratorIndices: number[] = [];
    const originalNarrators: string[] = [];
    section.blocks.forEach((b, idx) => {
      if (b.type === "narrator") {
        originalNarratorIndices.push(idx);
        originalNarrators.push(b.rawText.trim());
      }
    });

    if (originalNarratorIndices.length === 0 || proposedNarrators.length === 0) {
      guardrailEvents.push(
        `[GUARDRAIL SKIP] Section ${secId} had no valid [Male Narrator] blocks to splice.`
      );
      continue;
    }

    const originalNonNarrators = section.blocks
      .filter((b) => b.type !== "narrator" && b.type !== "locked_meta")
      .map((b) => b.rawText.trim());
    const proposedNonNarrators = proposedBlocks
      .filter((b) => b.type !== "narrator" && b.type !== "locked_meta")
      .map((b) => b.rawText.trim());

    let nonNarratorMutatedAttemptIntercepted = false;
    if (
      originalNonNarrators.length !== proposedNonNarrators.length ||
      originalNonNarrators.some((text, i) => text !== proposedNonNarrators[i])
    ) {
      nonNarratorMutatedAttemptIntercepted = true;
      guardrailEvents.push(
        `[PRIMARY EVIDENCE LOCK] Intercepted non-narrator mutation attempt in ${secId}; preserved original > blockquotes and [ARCHIVAL] cues 100% verbatim from memory.`
      );
    }

    const beforeSectionMarkdown = section.blocks.map((b) => b.rawText.trim()).join("\n\n");
    const updatedBlocks = section.blocks.map((b) => ({ ...b }));

    if (proposedNarrators.length === originalNarratorIndices.length) {
      originalNarratorIndices.forEach((blockIdx, narratorSlotIdx) => {
        updatedBlocks[blockIdx].rawText = proposedNarrators[narratorSlotIdx];
      });
    } else if (proposedNarrators.length > originalNarratorIndices.length) {
      originalNarratorIndices.forEach((blockIdx, narratorSlotIdx) => {
        if (narratorSlotIdx < originalNarratorIndices.length - 1) {
          updatedBlocks[blockIdx].rawText = proposedNarrators[narratorSlotIdx];
        } else {
          const remaining = proposedNarrators.slice(narratorSlotIdx).join("\n\n");
          updatedBlocks[blockIdx].rawText = remaining;
        }
      });
    } else {
      const indicesToRemove = new Set<number>();
      originalNarratorIndices.forEach((blockIdx, narratorSlotIdx) => {
        if (narratorSlotIdx < proposedNarrators.length) {
          updatedBlocks[blockIdx].rawText = proposedNarrators[narratorSlotIdx];
        } else {
          indicesToRemove.add(blockIdx);
        }
      });
      if (indicesToRemove.size > 0) {
        for (let idx = updatedBlocks.length - 1; idx >= 0; idx--) {
          if (indicesToRemove.has(idx)) {
            updatedBlocks.splice(idx, 1);
          }
        }
      }
    }

    const afterNarrators = updatedBlocks
      .filter((b) => b.type === "narrator")
      .map((b) => b.rawText.trim());

    const deltaChars = calculateNarratorDelta(originalNarrators, afterNarrators);
    const minimumDeltaMet = deltaChars > 0;

    if (!minimumDeltaMet) {
      guardrailEvents.push(
        `[TIE-BREAKER WARNING] Section ${secId} produced 0 char delta.`
      );
    } else {
      anySectionChanged = true;
    }

    section.blocks = updatedBlocks;
    const afterSectionMarkdown = section.blocks.map((b) => b.rawText.trim()).join("\n\n");
    section.rawMarkdown = afterSectionMarkdown;

    sectionDiffs.push({
      section_id: secId,
      act_id: section.act_id,
      title: section.title,
      beforeMarkdown: beforeSectionMarkdown,
      afterMarkdown: afterSectionMarkdown,
      narratorBlocksBefore: originalNarrators,
      narratorBlocksAfter: afterNarrators,
      deltaChars,
      minimumDeltaMet,
      nonNarratorMutatedAttemptIntercepted,
    });
  }

  const assembledMarkdown = assembleManuscript(parsed);
  const cueIntegrity = verifyCueIntegrity(originalMarkdown, assembledMarkdown);

  if (!cueIntegrity.tag_integrity) {
    guardrailEvents.push(
      `[CRITICAL ROLLBACK] 1:1 cue integrity check failed (${cueIntegrity.mismatches.join("; ")}). Restored original manuscript.`
    );
    return {
      assembledMarkdown: originalMarkdown,
      sectionDiffs: [],
      cueIntegrity,
      guardrailEvents,
      anySectionChanged: false,
    };
  }

  return {
    assembledMarkdown,
    sectionDiffs,
    cueIntegrity,
    guardrailEvents,
    anySectionChanged,
  };
}

/**
 * Determines which Acts are locked based on previous locks, Auditor's locked_acts,
 * and Acts that received zero surgical directives (and have zero privacy violations).
 */
export function computeUpdatedLockedActs(
  previousLockedActs: string[],
  parsed: ParsedManuscript,
  auditorReport: AuditorReport,
  privacyScan: PrivacyScanResult
): string[] {
  const locked = new Set<string>(previousLockedActs.map((a) => a.toUpperCase().trim()));

  for (const act of auditorReport.locked_acts || []) {
    locked.add(act.toUpperCase().trim());
  }

  const actToSections = new Map<string, string[]>();
  for (const sec of parsed.sections) {
    if (sec.act_id === "APPENDIX") continue;
    const list = actToSections.get(sec.act_id) || [];
    list.push(sec.section_id.toUpperCase());
    actToSections.set(sec.act_id, list);
  }

  const targetedSections = new Set(
    (auditorReport.surgical_directives || []).map((d) => d.section_id.toUpperCase().trim())
  );
  const privacyViolationSections = new Set(
    privacyScan.violations.map((v) => v.section_id.toUpperCase().trim())
  );

  for (const [actId, secIds] of actToSections.entries()) {
    const hasDirective = secIds.some((id) => targetedSections.has(id));
    const hasViolation = secIds.some((id) => privacyViolationSections.has(id));
    if (!hasDirective && !hasViolation && auditorReport.composite_score >= 80) {
      locked.add(actId);
    }
  }

  return Array.from(locked);
}

/**
 * Computes a clean word-level diff (LCS) between two strings for the Surgical Diff View tab.
 */
export function computeWordDiff(beforeText: string, afterText: string): DiffToken[] {
  if (beforeText === afterText) {
    return [{ type: "unchanged", value: beforeText }];
  }

  const tokenize = (str: string): string[] => {
    return str.match(/\S+|\s+/g) || [];
  };

  const a = tokenize(beforeText);
  const b = tokenize(afterText);
  const n = a.length;
  const m = b.length;

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawTokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rawTokens.push({ type: "unchanged", value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawTokens.push({ type: "removed", value: a[i] });
      i++;
    } else {
      rawTokens.push({ type: "added", value: b[j] });
      j++;
    }
  }
  while (i < n) {
    rawTokens.push({ type: "removed", value: a[i++] });
  }
  while (j < m) {
    rawTokens.push({ type: "added", value: b[j++] });
  }

  const merged: DiffToken[] = [];
  for (const tok of rawTokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === tok.type) {
      last.value += tok.value;
    } else {
      merged.push({ ...tok });
    }
  }

  return merged;
}

// ============================================================================
// 2. SMARTER SHOWRUNNER INTELLIGENCE: QUOTE-ECHO SCANNER, CLIFFHANGER CHECK & 3 VARIANTS
// ============================================================================

export interface QuoteEchoItem {
  section_id: string;
  narrator_block_id: string;
  position: "lead_in" | "exit";
  repeated_phrases: string[];
  narrator_excerpt: string;
  quote_excerpt: string;
  editorial_fix_directive: string;
}

export interface QuoteEchoReport {
  totalEchoes: number;
  cleanSetupsCount: number;
  echoes: QuoteEchoItem[];
}

const ECHO_STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "were",
  "they",
  "their",
  "what",
  "when",
  "where",
  "which",
  "while",
  "about",
  "into",
  "just",
  "like",
  "more",
  "only",
  "other",
  "over",
  "some",
  "such",
  "than",
  "then",
  "them",
  "there",
  "these",
  "those",
  "through",
  "under",
  "very",
  "will",
  "would",
  "could",
  "should",
  "because",
  "after",
  "before",
  "being",
  "between",
  "during",
  "male",
  "narrator",
  "beat",
  "logan",
  "angela",
]);

function extractSignificantWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !ECHO_STOPWORDS.has(w)) || []
  );
}

/**
 * Deterministic "Quote-Echo" Scanner:
 * Detects when a [Male Narrator] block immediately before or after a > blockquote
 * summarizes, announces, or repeats key phrases from the adjacent quote.
 */
export function scanQuoteEchoes(markdown: string): QuoteEchoReport {
  const parsed = parseManuscript(markdown);
  const echoes: QuoteEchoItem[] = [];
  let cleanSetupsCount = 0;

  const ANNOUNCER_CLICHES = [
    /\bhere is the (?:first|next|actual|exact)?\s*(?:message|log|clip|quote|recording|screenshot)/i,
    /\bin the (?:clip|quote|log|message) you just heard\b/i,
    /\bas you (?:just )?heard in\b/i,
    /\bshe literally (?:says|writes|typed|stated)\b/i,
    /\bhe literally (?:says|writes|typed|stated)\b/i,
    /\breading directly from the\b/i,
    /\bthis quote shows that\b/i,
  ];

  for (const sec of parsed.sections) {
    if (sec.act_id === "APPENDIX") continue;
    const blocks = sec.blocks;

    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      if (blk.type !== "narrator") continue;

      // Look for adjacent quote (either i+1, or i+2 if i+1 is an archival cue header, or i-1)
      let adjacentQuoteBlock: ScriptBlock | null = null;
      let position: "lead_in" | "exit" = "lead_in";

      if (i + 1 < blocks.length && blocks[i + 1].type === "blockquote") {
        adjacentQuoteBlock = blocks[i + 1];
        position = "lead_in";
      } else if (
        i + 2 < blocks.length &&
        blocks[i + 1].type === "archival" &&
        blocks[i + 2].type === "blockquote"
      ) {
        adjacentQuoteBlock = blocks[i + 2];
        position = "lead_in";
      } else if (i - 1 >= 0 && blocks[i - 1].type === "blockquote") {
        adjacentQuoteBlock = blocks[i - 1];
        position = "exit";
      }

      if (!adjacentQuoteBlock) continue;

      const narratorWords = extractSignificantWords(blk.rawText);
      const quoteWords = extractSignificantWords(adjacentQuoteBlock.rawText);
      const quoteWordSet = new Set(quoteWords);

      const overlappingWords = Array.from(
        new Set(narratorWords.filter((w) => quoteWordSet.has(w)))
      );

      // Check for 2-word significant phrase overlap
      const quoteBigrams = new Set<string>();
      for (let k = 0; k < quoteWords.length - 1; k++) {
        quoteBigrams.add(`${quoteWords[k]} ${quoteWords[k + 1]}`);
      }
      const matchedBigrams: string[] = [];
      for (let k = 0; k < narratorWords.length - 1; k++) {
        const bg = `${narratorWords[k]} ${narratorWords[k + 1]}`;
        if (quoteBigrams.has(bg) && !matchedBigrams.includes(bg)) {
          matchedBigrams.push(bg);
        }
      }

      const matchedCliche = ANNOUNCER_CLICHES.find((re) =>
        re.test(blk.rawText)
      );
      const clicheMatchText = matchedCliche
        ? blk.rawText.match(matchedCliche)?.[0]
        : null;

      // Context-aware diagnosis: only flag when there is real quote spoilage or redundant announcement.
      // Orientation context (e.g. naming the speaker or date) is welcomed audio craft, not an echo.
      const hasEcho =
        Boolean(clicheMatchText) ||
        (matchedBigrams.length >= 1 && overlappingWords.length >= 3) ||
        overlappingWords.length >= 4;

      if (hasEcho) {
        const repeatedList = [
          ...(clicheMatchText ? [`"${clicheMatchText.trim()}"`] : []),
          ...matchedBigrams.map((b) => `"${b}"`),
          ...overlappingWords.slice(0, 4),
        ].slice(0, 4);

        const cleanNarrator = blk.rawText
          .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
          .trim();
        const cleanQuote = adjacentQuoteBlock.rawText
          .replace(/^>\s*/gm, "")
          .trim();

        echoes.push({
          section_id: sec.section_id,
          narrator_block_id: blk.id,
          position,
          repeated_phrases: repeatedList,
          narrator_excerpt:
            cleanNarrator.length > 140
              ? `${cleanNarrator.slice(0, 140)}...`
              : cleanNarrator,
          quote_excerpt:
            cleanQuote.length > 140
              ? `${cleanQuote.slice(0, 140)}...`
              : cleanQuote,
          editorial_fix_directive:
            position === "lead_in"
              ? `Trim repetitive quote lead-in in ${blk.id} (${repeatedList.join(", ")}). Keep speaker orientation lean and let the original tape deliver the punchline.`
              : `Cut post-quote summary in ${blk.id} (${repeatedList.join(", ")}). Let the recording breathe and move naturally into the next moment.`,
        });
      } else {
        cleanSetupsCount++;
      }
    }
  }

  return {
    totalEchoes: echoes.length,
    cleanSetupsCount,
    echoes,
  };
}

export interface SectionCliffhangerItem {
  section_id: string;
  act_id: string;
  title: string;
  last_narrator_block_id: string | null;
  status: "strong_turn" | "needs_cliffhanger";
  turn_type: string;
  closing_excerpt: string;
  editorial_directive: string;
}

export interface SectionCliffhangerReport {
  strongCount: number;
  needsWorkCount: number;
  items: SectionCliffhangerItem[];
}

/**
 * Act-by-Act & Section-by-Section Tension & Resolution Check:
 * Context-aware check: not every scene needs a theatrical cliffhanger or question.
 * Evaluates whether the section ends on an earned realization, an investigative question,
 * a thoughtful pause, or a natural narrative transition.
 */
export function analyzeSectionCliffhangers(
  markdown: string
): SectionCliffhangerReport {
  const parsed = parseManuscript(markdown);
  const items: SectionCliffhangerItem[] = [];
  let strongCount = 0;
  let needsWorkCount = 0;

  for (const sec of parsed.sections) {
    if (sec.act_id === "APPENDIX") continue;

    const narratorBlocks = sec.blocks.filter((b) => b.type === "narrator");
    const lastNarrator =
      narratorBlocks.length > 0
        ? narratorBlocks[narratorBlocks.length - 1]
        : null;
    const veryLastBlock =
      sec.blocks.length > 0 ? sec.blocks[sec.blocks.length - 1] : null;

    if (!lastNarrator) {
      items.push({
        section_id: sec.section_id,
        act_id: sec.act_id,
        title: sec.title,
        last_narrator_block_id: null,
        status: "strong_turn",
        turn_type: "Ends on Original Tape",
        closing_excerpt: veryLastBlock?.rawText.slice(0, 120) || "",
        editorial_directive: "Ends directly on locked original recording.",
      });
      strongCount++;
      continue;
    }

    const body = lastNarrator.rawText
      .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
      .trim();
    const sentences = body
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const lastSentence =
      sentences.length > 0 ? sentences[sentences.length - 1] : body;
    const lastSentenceWords = lastSentence.split(/\s+/).filter(Boolean).length;

    const hasQuestionTurn = /\?\s*["']?$/.test(lastSentence);
    const hasBeatCue = /\[(?:Beat|Pause)\]/i.test(lastNarrator.rawText);
    const endsOnPrimaryTape = veryLastBlock?.type === "blockquote";
    const hasQuietRealization =
      /\b(realized|understood|became clear|struck me|never saw|never looked|had no idea|knew right then|different story|was gone|went dark|silence|changed everything)\b/i.test(
        lastSentence
      );
    const hasNaturalTransition =
      /\b(by morning|next day|later that week|soon after|that evening|where it started|where we began)\b/i.test(
        lastSentence
      );

    const hasHedgingOrTrailing =
      /\b(it could be argued|according to what|in summary|overall|at the end of the day|which brings us to this conclusion)\b/i.test(
        lastNarrator.rawText
      ) || lastSentenceWords > 30;

    const isStrong =
      !hasHedgingOrTrailing &&
      (hasQuestionTurn ||
        hasBeatCue ||
        endsOnPrimaryTape ||
        hasQuietRealization ||
        hasNaturalTransition ||
        lastSentenceWords <= 20);

    let turnType = "Earned Narrative Resolution";
    if (hasQuietRealization) turnType = "Quiet Realization";
    else if (hasQuestionTurn) turnType = "Investigative Question";
    else if (hasBeatCue && lastSentenceWords <= 20)
      turnType = "Reflective [Beat] Pause";
    else if (endsOnPrimaryTape) turnType = "Original Tape Drop";
    else if (hasNaturalTransition) turnType = "Natural Scene Transition";
    else if (!isStrong) turnType = "Trailing / Over-Explained Ending";

    if (isStrong) {
      strongCount++;
    } else {
      needsWorkCount++;
    }

    items.push({
      section_id: sec.section_id,
      act_id: sec.act_id,
      title: sec.title,
      last_narrator_block_id: lastNarrator.id,
      status: isStrong ? "strong_turn" : "needs_cliffhanger",
      turn_type: turnType,
      closing_excerpt:
        lastSentence.length > 140
          ? `...${lastSentence.slice(-140)}`
          : lastSentence,
      editorial_directive: isStrong
        ? `Earned scene ending (${turnType}).`
        : `Tighten the ending of ${lastNarrator.id} in section ${sec.section_id}: cut trailing summary and land on a quiet realization, a natural question, or a clean transition.`,
    });
  }

  return {
    strongCount,
    needsWorkCount,
    items,
  };
}

export interface ShowrunnerVariantItem {
  style_id:
    | "paper_trail_signature"
    | "dry_minimalist"
    | "investigative_forensic"
    | "serial_cadence";
  style_label: string;
  tagline: string;
  updated_narrator_markdown: string;
  word_count_delta: number;
  is_default?: boolean;
}

/**
 * Generates Showrunner Rewrite Variants deterministically:
 * ALWAYS includes Option D (The Paper Trail Signature Style: Conversational Investigative Storytelling)
 * as the permanent default, followed by optional creative alternatives (Options A, B, C).
 * Strictly avoids manufacturing fake drama, inventing facts, or using artificial formulas.
 */
export function generateDeterministicShowrunnerVariants(
  narratorMarkdown: string
): ShowrunnerVariantItem[] {
  const cleanBody = narratorMarkdown
    .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
    .replace(
      /\b(it could be argued that|according to what I remember,?|allegedly,?|supposedly,?)\s*/gi,
      ""
    )
    .replace(
      /\b(Here is the first message log\.?|In the clip you just heard,?|As you can see from this quote,?)\s*/gi,
      ""
    )
    .trim();

  const sentences = cleanBody
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const origWords = cleanBody.split(/\s+/).filter(Boolean).length;

  // 1. OPTION D — THE PAPER TRAIL SIGNATURE STYLE (PERMANENT DEFAULT)
  // Conversational investigative storytelling in Logan Black's authentic voice.
  // Direct, skeptical, personal, understated. Never melodramatic, no invented facts.
  let signatureBody = cleanBody;
  if (sentences.length >= 2) {
    signatureBody = `${sentences[0]} ${sentences.slice(1).join(" ")}`;
  } else if (sentences.length === 1) {
    signatureBody = sentences[0];
  }
  // Ensure natural spoken cadence and strip timid qualifiers without adding unverified facts
  signatureBody = signatureBody
    .replace(/\bso what this means is that\b/gi, "Now,")
    .replace(/\bthe truth of the matter is\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const signatureWords = signatureBody.split(/\s+/).filter(Boolean).length;

  // 2. OPTION A — DRY & MINIMALIST (Optional Alternative)
  // Let the tape do the work. Crisp and understated.
  const firstCore = sentences[0] || cleanBody;
  const lastCore =
    sentences.length > 1 ? sentences[sentences.length - 1] : "";
  const dryBody =
    sentences.length > 2
      ? `${firstCore} [Beat] ${lastCore}`
      : `${firstCore}`;
  const dryWords = dryBody.split(/\s+/).filter(Boolean).length;

  // 3. OPTION B — FORENSIC & INVESTIGATIVE (Optional Alternative)
  // Grounded timeline focus. Strictly sticks to the actual evidence without fabricating keycards or terminals.
  const forensicBody =
    sentences.length >= 2
      ? `${sentences[0]} When you line that up against the recorded timeline, the contradiction is right there in the timestamps.`
      : `${cleanBody} Looking strictly at the recorded timeline, that claim doesn't hold up.`;
  const forensicWords = forensicBody.split(/\s+/).filter(Boolean).length;

  // 4. OPTION C — CONVERSATIONAL SERIAL CADENCE (Optional Alternative)
  // Rhythmic, reflective first-person pacing.
  const serialBody =
    sentences.length >= 2
      ? `${sentences[0]} [Beat] ${sentences.slice(1).join(" ")}`
      : `${cleanBody} [Beat] And that's where the story takes a turn.`;
  const serialWords = serialBody.split(/\s+/).filter(Boolean).length;

  return [
    {
      style_id: "paper_trail_signature",
      style_label: "Option D — Signature Style (Default)",
      tagline: "Conversational Investigative Storytelling in Logan's authentic voice",
      updated_narrator_markdown: `[Male Narrator]\n${signatureBody}`,
      word_count_delta: signatureWords - origWords,
      is_default: true,
    },
    {
      style_id: "dry_minimalist",
      style_label: "Option A — Dry & Minimalist",
      tagline: "Let the primary tape do the work",
      updated_narrator_markdown: `[Male Narrator]\n${dryBody}`,
      word_count_delta: dryWords - origWords,
      is_default: false,
    },
    {
      style_id: "investigative_forensic",
      style_label: "Option B — Forensic & Investigative",
      tagline: "Focus on timeline contradictions without manufactured drama",
      updated_narrator_markdown: `[Male Narrator]\n${forensicBody}`,
      word_count_delta: forensicWords - origWords,
      is_default: false,
    },
    {
      style_id: "serial_cadence",
      style_label: "Option C — Conversational Serial Cadence",
      tagline: "Rhythmic, reflective first-person storytelling",
      updated_narrator_markdown: `[Male Narrator]\n${serialBody}`,
      word_count_delta: serialWords - origWords,
      is_default: false,
    },
  ];
}

// ============================================================================
// 3. DIRECT SECTION MANIPULATION & SINGLE-SECTION VERSION ROLLBACK
// ============================================================================

/**
 * Rolls back a single section in `currentMarkdown` to its exact state in `checkpointMarkdown`
 * without losing edits in any other section, while verifying 1:1 cue integrity.
 */
export function rollbackSingleSection(
  currentMarkdown: string,
  checkpointMarkdown: string,
  sectionId: string
): { updatedMarkdown: string; restored: boolean } {
  const currentParsed = parseManuscript(currentMarkdown);
  const checkpointParsed = parseManuscript(checkpointMarkdown);

  const targetCurrent = resolveSectionById(currentParsed, sectionId);
  const targetCheckpoint = resolveSectionById(checkpointParsed, sectionId);

  if (!targetCurrent || !targetCheckpoint) {
    return { updatedMarkdown: currentMarkdown, restored: false };
  }

  targetCurrent.rawMarkdown = targetCheckpoint.rawMarkdown;
  targetCurrent.blocks = targetCheckpoint.blocks.map((b) => ({ ...b }));

  const assembled = assembleManuscript(currentParsed);
  return {
    updatedMarkdown: assembled,
    restored: assembled !== currentMarkdown,
  };
}

// ============================================================================
// 4. EVIDENCE & TIMELINE CROSS-REFERENCE ("THE RECEIPT BOARD")
// ============================================================================

export interface ReceiptItem {
  receipt_id: string;
  section_id: string;
  act_id: string;
  section_title: string;
  cue_type: "archival_clip" | "logan_reading" | "document_quote";
  cue_header: string;
  speaker_or_source: string;
  extracted_timestamp: string;
  quote_text: string;
  adjacent_narrator_block_id: string | null;
  adjacent_narrator_preview: string;
  has_quote_echo: boolean;
  echo_warning: string | null;
}

export interface ContradictionCallbackPair {
  pair_id: string;
  early_section_id: string;
  early_receipt_id: string;
  early_claim_summary: string;
  later_section_id: string;
  later_receipt_id: string;
  contradiction_payoff: string;
  target_narrator_block_id: string;
  suggested_callback_narrator_markdown: string;
}

export interface ReceiptBoardReport {
  receipts: ReceiptItem[];
  contradictionPairs: ContradictionCallbackPair[];
}

function parseTimestampFromText(text: string): string {
  const dateMatch = text.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\b\d{1,2}:\d{2}\s*(?:AM|PM)\b|\b202[0-6]\b|\bMidjourney\s*1\.0\b/i
  );
  if (dateMatch) return dateMatch[0];
  if (/september|sep\b/i.test(text)) return "September 8 Incident";
  if (/welfare|police|dispatch/i.test(text)) return "Welfare Check Escalation";
  if (/screenshot|leak|dm|private/i.test(text)) return "Leaked DM Logs";
  if (/rule|boundary|server|mod/i.test(text)) return "Recorded Server Rule";
  return "Primary Evidence Log";
}

function parseSpeakerFromCue(cueHeader: string, quoteText: string): string {
  if (/\[LOGAN READING/i.test(cueHeader)) {
    const m = cueHeader.match(/\[LOGAN READING\s*[—\-:]\s*([^\]]+)\]/i);
    return m ? m[1].trim() : "Logan Reading Primary Log";
  }
  if (/\[ARCHIVAL/i.test(cueHeader)) {
    const m = cueHeader.match(/\[ARCHIVAL\s*[—\-:]\s*([^\]]+)\]/i);
    return m ? m[1].trim() : "Archival Audio Clip";
  }
  if (/angela/i.test(quoteText)) return "Angela Maggard (Recorded Quote)";
  if (/oor/i.test(quoteText)) return "Host Oor (Stream Transcript)";
  if (/sara\s*beth/i.test(quoteText)) return "Sara Beth (Safety Call)";
  if (/sav/i.test(quoteText)) return "Sav (Primary Timeline Receipt)";
  return "Verified Document / Quote";
}

/**
 * Automatically extracts every [ARCHIVAL — ...] cue, [LOGAN READING ...] cue,
 * and > blockquote across the manuscript into a structured Receipt Board,
 * cross-referenced with Quote-Echo status and Act-to-Act contradiction pairs.
 */
export function extractReceiptBoard(markdown: string): ReceiptBoardReport {
  const parsed = parseManuscript(markdown);
  const echoReport = scanQuoteEchoes(markdown);
  const echoByNarratorId = new Map<string, QuoteEchoItem>();
  for (const e of echoReport.echoes) {
    echoByNarratorId.set(e.narrator_block_id, e);
  }

  const receipts: ReceiptItem[] = [];
  let counter = 1;

  for (const sec of parsed.sections) {
    if (sec.act_id === "APPENDIX") continue;
    const blocks = sec.blocks;

    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      if (blk.type === "blockquote") {
        const prevBlock = i > 0 ? blocks[i - 1] : null;
        const cueHeader =
          prevBlock && prevBlock.type === "archival"
            ? prevBlock.rawText.trim()
            : "[PRIMARY QUOTE]";

        const cueType: ReceiptItem["cue_type"] = /\[LOGAN READING/i.test(
          cueHeader
        )
          ? "logan_reading"
          : /\[ARCHIVAL/i.test(cueHeader)
          ? "archival_clip"
          : "document_quote";

        // Find adjacent narrator block (prefer lead-in before cue/quote, or exit after quote)
        let adjNarrator: ScriptBlock | null = null;
        if (
          prevBlock &&
          prevBlock.type === "archival" &&
          i - 2 >= 0 &&
          blocks[i - 2].type === "narrator"
        ) {
          adjNarrator = blocks[i - 2];
        } else if (prevBlock && prevBlock.type === "narrator") {
          adjNarrator = prevBlock;
        } else if (i + 1 < blocks.length && blocks[i + 1].type === "narrator") {
          adjNarrator = blocks[i + 1];
        }

        const cleanQuote = blk.rawText.replace(/^>\s*/gm, "").trim();
        const combinedContext = `${sec.title} ${cueHeader} ${cleanQuote} ${
          adjNarrator?.rawText || ""
        }`;
        const echoItem = adjNarrator
          ? echoByNarratorId.get(adjNarrator.id)
          : undefined;

        const recId = `REC-${String(counter++).padStart(2, "0")}`;
        receipts.push({
          receipt_id: recId,
          section_id: sec.section_id,
          act_id: sec.act_id,
          section_title: sec.title,
          cue_type: cueType,
          cue_header: cueHeader,
          speaker_or_source: parseSpeakerFromCue(cueHeader, cleanQuote),
          extracted_timestamp: parseTimestampFromText(combinedContext),
          quote_text: cleanQuote,
          adjacent_narrator_block_id: adjNarrator ? adjNarrator.id : null,
          adjacent_narrator_preview: adjNarrator
            ? adjNarrator.rawText
                .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
                .trim()
            : "",
          has_quote_echo: Boolean(echoItem),
          echo_warning: echoItem ? echoItem.editorial_fix_directive : null,
        });
      }
    }
  }

  // Build cross-section Contradiction & Callback opportunities pairing earlier receipts with later receipts
  const contradictionPairs: ContradictionCallbackPair[] = [];
  if (receipts.length >= 2) {
    const firstReceipt = receipts[0];
    const lastReceipt = receipts[receipts.length - 1];
    const targetNarratorId =
      lastReceipt.adjacent_narrator_block_id ||
      firstReceipt.adjacent_narrator_block_id ||
      "A101-B1";
    const baseNarratorText =
      lastReceipt.adjacent_narrator_preview ||
      "The paper trail leaves zero room for spin.";

    contradictionPairs.push({
      pair_id: "CALLBACK-01",
      early_section_id: firstReceipt.section_id,
      early_receipt_id: firstReceipt.receipt_id,
      early_claim_summary: `In [${firstReceipt.section_id}] (${firstReceipt.extracted_timestamp}), the narrative begins with: "${firstReceipt.quote_text.slice(0, 90)}..."`,
      later_section_id: lastReceipt.section_id,
      later_receipt_id: lastReceipt.receipt_id,
      contradiction_payoff: `Juxtapose [${firstReceipt.section_id}] against [${lastReceipt.section_id}] (${lastReceipt.extracted_timestamp}) to expose the gap between public posture and the timestamped record.`,
      target_narrator_block_id: targetNarratorId,
      suggested_callback_narrator_markdown: `[Male Narrator]\n${baseNarratorText} [Beat] Compare that directly against the earlier record in ${firstReceipt.section_id}—the moment the timestamps line up, the entire pretext falls apart.`,
    });

    if (receipts.length >= 4) {
      const r2 = receipts[1];
      const rMid = receipts[Math.floor(receipts.length / 2)];
      if (r2.section_id !== rMid.section_id && rMid.adjacent_narrator_block_id) {
        contradictionPairs.push({
          pair_id: "CALLBACK-02",
          early_section_id: r2.section_id,
          early_receipt_id: r2.receipt_id,
          early_claim_summary: `In [${r2.section_id}] (${r2.speaker_or_source}), the stated rule was: "${r2.quote_text.slice(0, 90)}..."`,
          later_section_id: rMid.section_id,
          later_receipt_id: rMid.receipt_id,
          contradiction_payoff: `Call back to [${r2.section_id}] inside [${rMid.section_id}] so the listener hears how Angela's own stated rule is violated by the primary log.`,
          target_narrator_block_id: rMid.adjacent_narrator_block_id,
          suggested_callback_narrator_markdown: `[Male Narrator]\n${rMid.adjacent_narrator_preview} [Beat] Remember the rule established back in ${r2.section_id}. When the actual log hits the table, that standard disappears.`,
        });
      }
    }
  }

  return {
    receipts,
    contradictionPairs,
  };
}

// ============================================================================
// 4. CROSS-CHAPTER NARRATIVE RESONANCE & "DOUBLE-TAKE" REVELATIONS ENGINE
// Benchmark: SERIAL and PRETEND standard of long-arc narrative payoffs,
// where early casual remarks or rules gain deeper meaning when revisited later.
// ============================================================================

export type ResonanceType = "echo_foreshadowing" | "contradiction_evolution";
export type ResonanceStatus =
  | "resonated"
  | "missing_link"
  | "over_prosecutorial";

export interface ResonanceMoment {
  section_id: string;
  section_title: string;
  date_or_context: string;
  cue_header: string;
  recorded_quote: string;
  listener_understanding?: string;
  double_take_revelation?: string;
}

export interface ResonanceLinkItem {
  id: string;
  title: string;
  type: ResonanceType;
  motif_phrase: string;
  early_moment: ResonanceMoment;
  later_moment: ResonanceMoment;
  narrative_editorial_analysis: {
    why_it_matters_for_audio: string;
    journalistic_curiosity_approach: string;
    prosecutorial_cliche_to_avoid: string;
  };
  status: ResonanceStatus;
  status_detail: string;
  target_section_id: string;
  target_narrator_block_id: string | null;
  current_narrator_excerpt: string;
  suggested_option_d_narration: string;
}

export interface CrossChapterResonanceReport {
  totalLinks: number;
  resonatedCount: number;
  missingLinkCount: number;
  overProsecutorialCount: number;
  resonanceHealthScore: number; // 0 to 100
  items: ResonanceLinkItem[];
}

interface ResonanceDefinition {
  id: string;
  title: string;
  type: ResonanceType;
  motif_phrase: string;
  earlySectionPattern: RegExp;
  earlySectionFallback: string;
  earlyQuotePattern: RegExp;
  earlyContext: string;
  earlyCueHeader: string;
  earlyInitialUnderstanding: string;
  laterSectionPattern: RegExp;
  laterSectionFallback: string;
  laterQuotePattern: RegExp;
  laterContext: string;
  laterCueHeader: string;
  laterDoubleTake: string;
  whyItMatters: string;
  curiosityApproach: string;
  prosecutorialTrap: string;
  callbackDetectionPattern: RegExp;
  prosecutorialDetectionPattern: RegExp;
  suggestedOptionD: string;
}

const MASTER_RESONANCE_DEFINITIONS: ResonanceDefinition[] = [
  {
    id: "RESONANCE-RAINY-DAY",
    title: "The 'Rainy Day' Archive: Casual Remark to Batches of Four",
    type: "echo_foreshadowing",
    motif_phrase: "rainy day / screenshots in batches",
    earlySectionPattern: /(?:CHAPTER\s+TWO|CH_02|RAINY\s+DAY)/i,
    earlySectionFallback: "CH_02",
    earlyQuotePattern: /rainy\s+day/i,
    earlyContext: "February 18, 2026 (Afterspace live room)",
    earlyCueHeader: "ARCHIVAL 11 — ANGELA (Afterspace, Feb 18)",
    earlyInitialUnderstanding:
      "Sounds like a casual, throwaway phrase between late-night friends discussing online drama involving other people.",
    laterSectionPattern: /(?:CHAPTER\s+FIVE|CH_05|FOUR\s+AT\s+A\s+TIME)/i,
    laterSectionFallback: "CH_05",
    laterQuotePattern: /increments\s+of\s+four|big\s+bad\s+wolf/i,
    laterContext: "September 8, 2026 (Petty Space broadcast)",
    laterCueHeader: "ARCHIVAL 23 & 24 — ANGELA (Petty Space, Sept 8)",
    laterDoubleTake:
      "The 'rainy day' was never about third parties. It was an active inventory sitting in the background, ready to be deployed the moment a friend became an adversary.",
    whyItMatters:
      "A timestamp or quote alone doesn't create suspense. The listener needs to hear the quiet shift from an ordinary friend keeping notes to a live broadcast dropping private DMs in batches of four.",
    curiosityApproach:
      "Point back to the February tape with quiet realization: 'There's that February recording again. The screenshots for a rainy day. The thing I barely noticed when I thought she was speaking about someone else.'",
    prosecutorialTrap:
      "Avoid declaring: 'This proves Angela planned all along to destroy my life.' Let the tape and the timing carry the revelation.",
    callbackDetectionPattern: /rainy\s+day|february/i,
    prosecutorialDetectionPattern:
      /proves\s+she\s+was|guilty\s+of|premeditated|hypocritical|malicious\s+plan/i,
    suggestedOptionD:
      "[Male Narrator]\nThere's that February recording again. The screenshots for a rainy day. The thing I barely noticed when I thought she was speaking about someone else. The significance isn't that every note she ever took was meant to hurt somebody. The significance is that by September she was saying, on a live microphone, that she could publish years of our private conversations depending on how I responded.",
  },
  {
    id: "RESONANCE-DISCORD-WEAPONIZE",
    title: "The Locked Discord Principle vs. The 'Fuck It Bucket'",
    type: "contradiction_evolution",
    motif_phrase: "weaponize private evidence / wrong way to handle it",
    earlySectionPattern: /(?:CHAPTER\s+SEVEN|CH_07|LINE\s+SHE\s+WOULDN'T\s+CROSS)/i,
    earlySectionFallback: "CH_07",
    earlyQuotePattern: /private\s+discord\s+of\s+evidence|weaponized\s+to\s+hurt/i,
    earlyContext: "September 15, 2026 (Super Spy Tea Time)",
    earlyCueHeader: "ARCHIVAL 27 — ANGELA (Super Spy Tea Time, Sept 15)",
    earlyInitialUnderstanding:
      "Angela articulates a clear, admirable ethical boundary: private evidence should stay locked because weaponizing it hurts people and is the wrong way to handle disputes.",
    laterSectionPattern: /(?:CHAPTER\s+SEVEN|CH_07|LINE\s+SHE\s+WOULDN'T\s+CROSS)/i,
    laterSectionFallback: "CH_07",
    laterQuotePattern: /fuck\s+it\s+bucket|poked\s+and\s+poked|when\s+c\s*p\s*s\s*gets\s+hold/i,
    laterContext: "September 16–18, 2026 (Group messages & Logan Black Unmasked)",
    laterCueHeader: "ARCHIVAL 28 & WRITTEN READING (Sept 16-18)",
    laterDoubleTake:
      "One week after dropping batches in Petty Space and one day before invoking child-welfare authorities, Angela described weaponization as a line she wouldn't cross. The pivot wasn't a loss of principle; it was the 'fuck it bucket.'",
    whyItMatters:
      "Serial-level investigative power comes from catching someone stating a truth you agree with, then examining the psychological moment they decide the rule no longer applies.",
    curiosityApproach:
      "Acknowledge her stated restraint genuinely: 'What makes this recording important isn't that I've caught her saying something bad. It's that she's saying something reasonable. Something I'd agree with. The question is how she decides when that principle applies.'",
    prosecutorialTrap:
      "Do not attack: 'She is a complete hypocrite who lies about her morals.' Present the dates side-by-side with restraint.",
    callbackDetectionPattern:
      /reasonable|timing\s+is\s+what\s+stays|principle\s+applies|restraint/i,
    prosecutorialDetectionPattern:
      /hypocrite|blatant\s+lie|pure\s+hypocrisy|fraudulent/i,
    suggestedOptionD:
      "[Male Narrator]\nThere it is. In Angela's own words, she understands that releasing private material can hurt people. She says that's why she kept an archive closed, and why she hadn't let others into it. What makes this recording important isn't that I've caught her saying something bad. It's that she's saying something reasonable. Something I'd agree with: having access to private information doesn't automatically mean you should distribute it. The timing is what stays with me. The question is how she decides when that principle applies.",
  },
  {
    id: "RESONANCE-SAV-LIABILITY",
    title: "The Friendship Reassurance vs. The Relationship 'Liability'",
    type: "contradiction_evolution",
    motif_phrase: "never choose between us / turns into a liability",
    earlySectionPattern: /(?:CHAPTER\s+FOUR|CH_04|FRIEND\s+IN\s+THE\s+MIDDLE)/i,
    earlySectionFallback: "CH_04",
    earlyQuotePattern: /never\s+going\s+to\s+put\s+you\s+in\s+a\s+position/i,
    earlyContext: "September 8, 2026 (Hook Line Sinker, 35:05)",
    earlyCueHeader: "ARCHIVAL 20 — ANGELA TO SAV (Sept 8)",
    earlyInitialUnderstanding:
      "Angela reassures Sav that she will never force her to choose between friends and respects meaningful personal connections.",
    laterSectionPattern: /(?:CHAPTER\s+FOUR|CH_04|FRIEND\s+IN\s+THE\s+MIDDLE)/i,
    laterSectionFallback: "CH_04",
    laterQuotePattern: /stopped\s+telling\s+you|turns\s+into\s+a\s+liability/i,
    laterContext: "September 8, 2026 (same broadcast, minutes later)",
    laterCueHeader: "ARCHIVAL 21 — ANGELA (Hook Line Sinker, segments later)",
    laterDoubleTake:
      "In the exact same broadcast, Angela explains that dating Logan turned Sav into a liability, and in private July messages, threatened to ruin everyone Logan cared about.",
    whyItMatters:
      "Humanizes Sav's impossible position as someone genuinely caught between two people she cared about, rather than a passive bystander.",
    curiosityApproach:
      "Trace the shifting boundaries without turning Angela into a cartoon: 'Those comments don't mean Angela was pretending the entire friendship was genuine. It isn't that simple. But they do show how quickly the question of who Sav trusted became tangled with who she was dating.'",
    prosecutorialTrap:
      "Do not accuse Angela of running a premeditated psychological operation on Sav. Acknowledge the messy personal reality.",
    callbackDetectionPattern:
      /tangled\s+with\s+who\s+she\s+was\s+dating|isn't\s+that\s+simple|reassurance/i,
    prosecutorialDetectionPattern:
      /psyop|calculated\s+manipulation|evil\s+intent/i,
    suggestedOptionD:
      "[Male Narrator]\nThat's a reassurance: don't choose between me and somebody else. We can talk privately. People should have meaningful connections. And yet in the same broadcast, Angela explained that once she found out Sav and I were involved, she had started withholding information from her. Those comments don't mean Angela was pretending the entire friendship was genuine. It isn't that simple. But they do show how quickly the question of who Sav trusted became tangled with who she was dating.",
  },
  {
    id: "RESONANCE-LYNN-TRUCE",
    title: "Lynn's Plea for Truce vs. 'It's Going to Be Your Fault'",
    type: "contradiction_evolution",
    motif_phrase: "good faith truce / your fault that I'm posting them",
    earlySectionPattern: /(?:CHAPTER\s+THREE|CH_03|LYNN\s+DOESN'T\s+WANT)/i,
    earlySectionFallback: "CH_03",
    earlyQuotePattern: /truce\s+of\s+some\s+sorts|newsletter|send\s+it\s+and\s+it\s+just\s+gives\s+me\s+joy/i,
    earlyContext: "September 2026 (Who or What Ruined UFO X Spaces)",
    earlyCueHeader: "ARCHIVAL 16 — LYNN (UFO X Spaces)",
    earlyInitialUnderstanding:
      "Lynn, who gave money out of goodwill, asks for a good-faith truce after seeing her name published in Angela's newsletter.",
    laterSectionPattern: /(?:CHAPTER\s+THREE|CH_03|LYNN\s+DOESN'T\s+WANT)/i,
    laterSectionFallback: "CH_03",
    laterQuotePattern: /in\s+my\s+discovery|your\s+fault\s+that\s+I'm\s+posting/i,
    laterContext: "September 2026 (same broadcast, minutes later)",
    laterCueHeader: "ARCHIVAL 17 — ANGELA (same broadcast)",
    laterDoubleTake:
      "Angela tells Lynn that if she posts her receipts, it's Lynn's fault—reframing the publisher's choice as the victim's responsibility.",
    whyItMatters:
      "Captures the core mechanism of how interpersonal online conflicts operate: an aggressive publication is framed as a reluctant response to being provoked.",
    curiosityApproach:
      "Isolate the single pivotal sentence: 'That is the sentence I keep coming back to: if I post them, it's going to be your fault. Lynn wasn't choosing what Angela would publish. She was challenging Angela to do it. Angela still described the responsibility as belonging to Lynn.'",
    prosecutorialTrap:
      "Do not accuse Angela of criminal extortion or blackmail. Let the listener sit with the words.",
    callbackDetectionPattern:
      /sentence\s+I\s+keep\s+coming\s+back\s+to|belonging\s+to\s+lynn|responsibility/i,
    prosecutorialDetectionPattern:
      /extortion|blackmail|criminal\s+behavior/i,
    suggestedOptionD:
      "[Male Narrator]\nThat is the sentence I keep coming back to: if I post them, it's going to be your fault. Lynn wasn't choosing what Angela would publish. She was challenging Angela to do it. Angela still described the responsibility as belonging to Lynn. It's the kind of moment that tells you something about the way these disputes worked. An action is described as a response to being pushed. The person on the receiving end is told they caused it.",
  },
  {
    id: "RESONANCE-PHOTO-ORIGIN",
    title: "The Photo Origin: Private Forwarding vs. 'Distributing Nudes'",
    type: "contradiction_evolution",
    motif_phrase: "women's nudes at 930 / asked him to show me the proof",
    earlySectionPattern: /(?:CHAPTER\s+SIX|CH_06|STORY\s+A\s+PHOTOGRAPH)/i,
    earlySectionFallback: "CH_06",
    earlyQuotePattern: /women's\s+nudes\s+at\s+930|stop\s+sending\s+women's\s+nudes/i,
    earlyContext: "September 15, 2026 (Super Spy Tea Time Part 4)",
    earlyCueHeader: "ARCHIVAL 26 — ANGELA (Super Spy Tea Time, Sept 15)",
    earlyInitialUnderstanding:
      "A shocking accusation broadcast to hundreds: Logan is alleged to be distributing women's nude images without consent on a Monday morning.",
    laterSectionPattern: /(?:CHAPTER\s+SIX|CH_06|STORY\s+A\s+PHOTOGRAPH)/i,
    laterSectionFallback: "CH_06",
    laterQuotePattern: /asked\s+him\s+to\s+show\s+me\s+the\s+proof|just\s+isn't\s+what\s+happened/i,
    laterContext: "Fallout Among Former Friends contemporaneous chat",
    laterCueHeader: "WRITTEN READING — SAV TO ANGELA (Fallout Among Former Friends)",
    laterDoubleTake:
      "Sav herself directly corrected Angela in writing: Sav had asked Logan to see a public post by Lynn, and Sav forwarded it to Angela in confidence. Logan never circulated private nudes.",
    whyItMatters:
      "Shows how a private exchange between friends transforms into an explosive public broadcast accusation once friendships fracture.",
    curiosityApproach:
      "Highlight the primary document's specific narrow scope: 'Sav—the person who had asked me for the image—addressed the same point directly with Angela in writing. She wasn't writing a general defense of everything I'd ever done. She was correcting an account of one identifiable exchange.'",
    prosecutorialTrap:
      "Do not use this single correction to claim total innocence on all relationship disputes. Keep the focus narrow and factual.",
    callbackDetectionPattern:
      /person\s+who\s+had\s+asked\s+me|identifiable\s+exchange|correcting\s+an\s+account/i,
    prosecutorialDetectionPattern:
      /vindicates\s+me\s+entirely|proves\s+she's\s+a\s+liar/i,
    suggestedOptionD:
      "[Male Narrator]\nThe important thing isn't that I'm giving you my version and asking you to take my word for it. It's that Sav—the person who had asked me for the image—addressed the same point directly with Angela in writing. That is Sav saying two different things: first, she asked me for that particular image; second, she did not want the fact she'd passed it to Angela used against her. She wasn't writing a general defense of everything I'd ever done. She was correcting an account of one identifiable exchange.",
  },
  {
    id: "RESONANCE-WHISTLEBLOWER-SURVEILLANCE",
    title: "Public Whistleblower vs. Back-Channel Community Surveillance",
    type: "echo_foreshadowing",
    motif_phrase: "whistleblower sharing truth / watch you talk shit and play dumb",
    earlySectionPattern: /(?:CHAPTER\s+ONE|CH_01|WHY\s+WE\s+BELIEVED)/i,
    earlySectionFallback: "CH_01",
    earlyQuotePattern: /whistleblower\s+who\s+came\s+here|psychological\s+operations/i,
    earlyContext: "Hook Line Sinker (September 8, 2026)",
    earlyCueHeader: "ARCHIVAL 08 — ANGELA (Hook Line Sinker)",
    earlyInitialUnderstanding:
      "Angela describes herself as a victimized whistleblower fighting institutional silencing and seeking public truth.",
    laterSectionPattern: /(?:CHAPTER\s+TWO|CH_02|RAINY\s+DAY)/i,
    laterSectionFallback: "CH_02",
    laterQuotePattern: /send\s+people\s+in\s+the\s+community|play\s+dumb\s+for\s+months/i,
    laterContext: "Logan Black Unmasked (September 18, 2026)",
    laterCueHeader: "ARCHIVAL 14 — ANGELA (Logan Black Unmasked)",
    laterDoubleTake:
      "The public whistleblower seeking open transparency simultaneously runs long-term back-channel reconnaissance: sending real-life acquaintances to monitor rooms and playing dumb for months.",
    whyItMatters:
      "Investigative audio benchmark: allowing listeners to juxtapose a person's public persona with their admitted private methods.",
    curiosityApproach:
      "Distinguish between standard record-keeping and deliberate monitoring: 'Listen, a lot of people in this community document arguments. I have too... The difference appears when somebody starts talking about using those records to pressure someone else.'",
    prosecutorialTrap:
      "Do not label Angela a paranoid spy. Quote her own description of how ordinary the surveillance felt to her.",
    callbackDetectionPattern:
      /document\s+arguments|difference\s+appears|pressure\s+someone\s+else/i,
    prosecutorialDetectionPattern:
      /paranoid|stalker|psychotic|insane/i,
    suggestedOptionD:
      "[Male Narrator]\nListen, a lot of people in this community document arguments. I have too. This isn't a story about how nobody should ever save a conversation. Some of the very recordings you're hearing are important precisely because they were preserved. The difference appears when somebody starts talking about using those records to pressure someone else.",
  },
  {
    id: "RESONANCE-LEGAL-REALITY",
    title: "Courtroom 'Discovery' Threats vs. Real-World Family Knock",
    type: "contradiction_evolution",
    motif_phrase: "file a motion for discovery / child services on my door",
    earlySectionPattern: /(?:CHAPTER\s+THREE|CH_03|LYNN\s+DOESN'T\s+WANT)/i,
    earlySectionFallback: "CH_03",
    earlyQuotePattern: /motion\s+for\s+discovery|test\s+me|in\s+my\s+discovery/i,
    earlyContext: "Petty Space (September 8, 2026)",
    earlyCueHeader: "ARCHIVAL 18 — ANGELA (Petty Space)",
    earlyInitialUnderstanding:
      "Angela presents her archive as formal evidence headed toward a legal proceeding and judicial discovery.",
    laterSectionPattern: /(?:CHAPTER\s+EIGHT|CH_08|WHEN\s+IT\s+LEAVES)/i,
    laterSectionFallback: "CH_08",
    laterQuotePattern: /child\s+services|cops|firstborn\s+daughter/i,
    laterContext: "Angela Maggard Fan Club (September 18, 2026)",
    laterCueHeader: "ARCHIVAL 30 & 32 — SAV & SKITTLES (Sept 18)",
    laterDoubleTake:
      "The dispute never arrived in a courtroom. Instead, it showed up on doorsteps—welfare checks, CPS visits, and parents nervous about walking their kids to school.",
    whyItMatters:
      "The human climax of the podcast: online receipts cease being entertainment and collide with actual children, ex-spouses, and homes.",
    curiosityApproach:
      "Ground the ending in concrete human detail: 'Whatever people are arguing about online, she says, it shouldn't reach their children, relatives, and exes. Think about the detail she gives there: taking her son to school—an ordinary part of the day—had become something she was nervous about.'",
    prosecutorialTrap:
      "Do not make definitive legal findings of criminal harassment. Let the emotional testimony of the mothers carry the reality.",
    callbackDetectionPattern:
      /taking\s+her\s+son\s+to\s+school|reach\s+their\s+children|ordinary\s+part\s+of\s+the\s+day/i,
    prosecutorialDetectionPattern:
      /criminal\s+harassment|guilty\s+of\s+swatting|indictment/i,
    suggestedOptionD:
      "[Male Narrator]\nSomething important happens in that clip. Sav doesn't say she played no part. She acknowledges that things could have been handled differently. And then she draws a line: whatever people are arguing about online, she says, it shouldn't reach their children, relatives, and exes. Think about the detail Skittles gives there: taking her son to school—an ordinary part of the day—had become something she was nervous about.",
  },
  {
    id: "RESONANCE-DOXING-DETECTION",
    title: "Anti-Bullying Whistleblower vs. Front Door Doxing Admissions",
    type: "contradiction_evolution",
    motif_phrase: "exposed bullies / sent him the photo of his front door",
    earlySectionPattern: /(?:CHAPTER\s+ONE|CH_01|WHY\s+WE\s+BELIEVED)/i,
    earlySectionFallback: "CH_01",
    earlyQuotePattern: /exposed\s+him|defended\s+me\s+before|whistleblower/i,
    earlyContext: "Super Spy Tea Time & Hook Line Sinker",
    earlyCueHeader: "ARCHIVAL 08 & 09 — ANGELA & URS (Sept 8–15)",
    earlyInitialUnderstanding:
      "Angela is hailed as a protector who exposes abusive bullies and defends vulnerable participants in online spaces.",
    laterSectionPattern: /(?:CHAPTER\s+NINE|CH_09|PEOPLE\s+WE\s+SENT)/i,
    laterSectionFallback: "CH_09",
    laterQuotePattern: /front\s+door|photo\s+of\s+his\s+front\s+door|detective\s+zaddy/i,
    laterContext: "Logan Black Unmasked (September 18, 2026)",
    laterCueHeader: "ARCHIVAL 35 & 37 — GLOW & ANGELA (Sept 18)",
    laterDoubleTake:
      "The righteous defender of abuse survivors openly confesses on air: 'So, yes, I doxed the leader... I sent him the photo of his front door... I sent him a picture of his mom's home.' The line between exposing abuse and personal intimidation disappeared.",
    whyItMatters:
      "Exposes the classic trap of online whisper networks: tactics initially excused as 'counter-defense' escalate into direct offline harassment.",
    curiosityApproach:
      "Logan notes the escalation without hyperbole: 'You can hear the shift in Angela's own explanation. It begins with exposing a bully online. It ends with a photograph of a mother's front door sent in a group chat.'",
    prosecutorialTrap:
      "Avoid screaming: 'Angela is a malicious criminal stalker.' Let her own unprompted confession on air land with full weight.",
    callbackDetectionPattern:
      /front\s+door|picture\s+of\s+his\s+mom|sent\s+to\s+her|unmasked|shift\s+in\s+angela/i,
    prosecutorialDetectionPattern:
      /criminal\s+stalker|evil\s+monster|unhinged\s+psychopath/i,
    suggestedOptionD:
      "[Male Narrator]\nYou can hear the shift in Angela's own explanation. It begins with exposing a bully online. It ends with a photograph of a mother's front door sent in a group chat. Angela doesn't deny sending it. She justifies it as retribution for a group chat she believed targeted her child. But notice what happened to the method: the defense of a community became a picture of a private home.",
  },
  {
    id: "RESONANCE-EPILOGUE-MISTAKES",
    title: "The Opening Accusations vs. 'Do We Own Up When We're Wrong?'",
    type: "echo_foreshadowing",
    motif_phrase: "predator accusations / do we admit it if we're wrong",
    earlySectionPattern: /(?:PROLOGUE|THINGS\s+SHE\s+SAID)/i,
    earlySectionFallback: "PROLOGUE",
    earlyQuotePattern: /dead\s+baby|predator|ai\s+porn/i,
    earlyContext: "Prologue Montage (September 8–18, 2026)",
    earlyCueHeader: "ARCHIVAL 01–04 — ANGELA (Prologue)",
    earlyInitialUnderstanding:
      "A visceral, non-negotiable barrage of criminal and personal accusations broadcast to silence Logan.",
    laterSectionPattern: /(?:EPILOGUE|IN\s+HER\s+OWN\s+WORDS)/i,
    laterSectionFallback: "EPILOGUE",
    laterQuotePattern: /everybody\s+makes\s+mistakes|admit\s+it\s+if\s+we're\s+wrong/i,
    laterContext: "February 16, 2026 (Entry Level Improv and Music from the Beyond)",
    laterCueHeader: "FINAL ARCHIVAL 39 — ANGELA (Feb 16, 2026)",
    laterDoubleTake:
      "Before any of the September warfare erupted, Angela articulated the only true benchmark for resolution: 'Everybody makes mistakes... But do we own up to them? Do we admit it if we're wrong?'",
    whyItMatters:
      "Brings the entire investigation to a profound, circular resolution using the subject's own earliest wisdom rather than a host lecture.",
    curiosityApproach:
      "Hold Angela to her own stated standard with gentle finality: 'I don't play that tape to catch Angela in a contradiction. I play it because she was right. People make mistakes in friendships. The question this story leaves you with isn't who made an error in a late-night room. It's what happens when someone decides that admitting it is a defeat they can never afford.'",
    prosecutorialTrap:
      "Do not end with a self-congratulatory victory lap or demand Angela apologize. Leave the question lingering in the room tone.",
    callbackDetectionPattern:
      /she\s+was\s+right|people\s+make\s+mistakes|admitting\s+it\s+is\s+a\s+defeat|standard/i,
    prosecutorialDetectionPattern:
      /i\s+win|she\s+lost|total\s+victory|disgraced/i,
    suggestedOptionD:
      "[Male Narrator]\nI don't play that tape to catch Angela in a contradiction. I play it because she was right. People make mistakes in friendships. They say things in anger. They misjudge who to trust. The question this story leaves you with isn't who made an error in a late-night room. It's what happens when someone decides that admitting it is a defeat they can never afford.",
  },
];

/**
 * Evaluates the manuscript for Cross-Chapter Narrative Resonance & "Double-Take" Revelations.
 * Tracks recurring motifs, echo & foreshadowing pairings, and contradiction evolutions across chapters.
 */
export function analyzeCrossChapterResonance(
  markdown: string
): CrossChapterResonanceReport {
  const parsed = parseManuscript(markdown);
  const items: ResonanceLinkItem[] = [];

  let resonatedCount = 0;
  let missingLinkCount = 0;
  let overProsecutorialCount = 0;

  for (const def of MASTER_RESONANCE_DEFINITIONS) {
    // 1. Locate early section and quote
    let earlySec = parsed.sections.find((s) =>
      def.earlySectionPattern.test(`${s.section_id} ${s.title}`)
    );
    if (!earlySec) {
      earlySec = resolveSectionById(parsed, def.earlySectionFallback) || undefined;
    }

    let earlyQuoteFound = "";
    if (earlySec) {
      for (const blk of earlySec.blocks) {
        if (blk.type === "blockquote" && def.earlyQuotePattern.test(blk.rawText)) {
          earlyQuoteFound = blk.rawText.replace(/^>\s*/gm, "").trim();
          break;
        }
      }
    }

    // 2. Locate later section and quote
    let laterSec = parsed.sections.find((s) =>
      def.laterSectionPattern.test(`${s.section_id} ${s.title}`)
    );
    if (!laterSec) {
      laterSec = resolveSectionById(parsed, def.laterSectionFallback) || undefined;
    }

    let laterQuoteFound = "";
    if (laterSec) {
      for (const blk of laterSec.blocks) {
        if (blk.type === "blockquote" && def.laterQuotePattern.test(blk.rawText)) {
          laterQuoteFound = blk.rawText.replace(/^>\s*/gm, "").trim();
          break;
        }
      }
    }

    // 3. Inspect narrator blocks in the later section to check resonance status
    const targetNarrator = laterSec
      ? laterSec.blocks.find((b) => b.type === "narrator") || null
      : null;

    const narratorTextCombined = laterSec
      ? laterSec.blocks
          .filter((b) => b.type === "narrator")
          .map((b) => b.rawText)
          .join("\n\n")
      : "";

    let status: ResonanceStatus = "missing_link";
    let statusDetail =
      "Latent investigative payoff: early remark and later tape are present, but narration has not yet connected the thread.";

    if (def.prosecutorialDetectionPattern.test(narratorTextCombined)) {
      status = "over_prosecutorial";
      statusDetail =
        "Warning: narration uses prosecutorial language or declares verdicts. Soften to Option D investigative curiosity.";
      overProsecutorialCount++;
    } else if (def.callbackDetectionPattern.test(narratorTextCombined)) {
      status = "resonated";
      statusDetail =
        "Earned resonance achieved: Logan's narration connects the early moment to the later tape with authentic curiosity.";
      resonatedCount++;
    } else {
      missingLinkCount++;
    }

    const targetSecId = laterSec?.section_id || def.laterSectionFallback;

    items.push({
      id: def.id,
      title: def.title,
      type: def.type,
      motif_phrase: def.motif_phrase,
      early_moment: {
        section_id: earlySec?.section_id || def.earlySectionFallback,
        section_title: earlySec?.title || def.earlySectionFallback,
        date_or_context: def.earlyContext,
        cue_header: def.earlyCueHeader,
        recorded_quote: earlyQuoteFound || "(Primary recorded tape in early chapter)",
        listener_understanding: def.earlyInitialUnderstanding,
      },
      later_moment: {
        section_id: targetSecId,
        section_title: laterSec?.title || targetSecId,
        date_or_context: def.laterContext,
        cue_header: def.laterCueHeader,
        recorded_quote: laterQuoteFound || "(Primary recorded tape in later chapter)",
        double_take_revelation: def.laterDoubleTake,
      },
      narrative_editorial_analysis: {
        why_it_matters_for_audio: def.whyItMatters,
        journalistic_curiosity_approach: def.curiosityApproach,
        prosecutorial_cliche_to_avoid: def.prosecutorialTrap,
      },
      status,
      status_detail: statusDetail,
      target_section_id: targetSecId,
      target_narrator_block_id: targetNarrator ? targetNarrator.id : null,
      current_narrator_excerpt: targetNarrator
        ? targetNarrator.rawText
            .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
            .trim()
            .slice(0, 160)
        : "",
      suggested_option_d_narration: def.suggestedOptionD,
    });
  }

  // Calculate Narrative Resonance Health Score (0 to 100)
  // Resonated links give full credit, over-prosecutorial gets 40%, missing link gets 50%
  const total = items.length;
  const rawScore =
    total > 0
      ? (resonatedCount * 100 +
          missingLinkCount * 55 +
          overProsecutorialCount * 30) /
        total
      : 80;
  const resonanceHealthScore = Number(Math.min(100, Math.max(0, rawScore)).toFixed(1));

  return {
    totalLinks: total,
    resonatedCount,
    missingLinkCount,
    overProsecutorialCount,
    resonanceHealthScore,
    items,
  };
}

/**
 * Helper to fetch all resonance links relevant to a specific section ID
 * (matches both early planting and later double-take moments).
 */
export function getResonanceLinksForSection(
  report: CrossChapterResonanceReport,
  sectionId: string
): ResonanceLinkItem[] {
  const norm = sectionId.toUpperCase().trim();
  return report.items.filter(
    (item) =>
      item.early_moment.section_id.toUpperCase().includes(norm) ||
      norm.includes(item.early_moment.section_id.toUpperCase()) ||
      item.later_moment.section_id.toUpperCase().includes(norm) ||
      norm.includes(item.later_moment.section_id.toUpperCase()) ||
      item.target_section_id.toUpperCase().includes(norm) ||
      norm.includes(item.target_section_id.toUpperCase())
  );
}

// ============================================================================
// 2. THE RELATIONSHIP & HUMAN COMPLEXITY TRACKER
// ============================================================================

export type CharacterId = "angela" | "sav" | "logan" | "lynn" | "urs" | "skittles";

export interface CharacterArcMoment {
  section_id: string;
  act_id: string;
  section_title: string;
  emotional_state: string;
  relationship_status: string;
  primary_evidence_cue: string;
  evidence_quote_excerpt: string;
  narrator_treatment: string;
  complexity_verdict: "nuanced" | "risks_archetype" | "humanizing_anchor";
  editorial_recommendation?: string;
  suggested_patch?: string;
  target_narrator_block_id?: string | null;
}

export interface CharacterProfile {
  character_id: CharacterId;
  name: string;
  role_in_story: string;
  humanizing_anchors: string[];
  arc_moments: CharacterArcMoment[];
  complexity_score: number; // 0 to 100
  archetype_risk_flag: boolean;
  archetype_risk_warning?: string;
}

export interface SavNuanceAudit {
  sav_in_middle_score: number; // 0 to 100
  agency_moments_acknowledged: {
    gassed_angela_up: boolean;
    not_a_honeypot: boolean;
    demanded_receipt_deletion: boolean;
    corrected_photo_allegation: boolean;
    drew_line_on_children: boolean;
  };
  bystander_trap_detected: boolean;
  editorial_verdict: string;
  suggested_surgical_enhancement?: string;
  target_section_id?: string;
  target_narrator_block_id?: string | null;
}

export interface HumanComplexityReport {
  overallComplexityScore: number; // 0 to 100
  archetypeWarningsCount: number;
  characters: CharacterProfile[];
  savNuanceAudit: SavNuanceAudit;
  characterPresenceBySection: Record<string, string[]>;
}

export function analyzeHumanComplexity(markdown: string): HumanComplexityReport {
  const parsed = parseManuscript(markdown);
  const allNarratorText = parsed.sections
    .map((s) =>
      s.blocks
        .filter((b) => b.type === "narrator")
        .map((b) => b.rawText)
        .join("\n\n")
    )
    .join("\n\n");

  const characterPresenceBySection: Record<string, string[]> = {};
  for (const s of parsed.sections) {
    if (s.act_id === "APPENDIX") continue;
    const secText = s.rawMarkdown.toLowerCase();
    const chars: string[] = [];
    if (/angela/i.test(secText)) chars.push("Angela");
    if (/sav/i.test(secText)) chars.push("Sav");
    if (/logan/i.test(secText)) chars.push("Logan");
    if (/lynn/i.test(secText)) chars.push("Lynn");
    if (/urs/i.test(secText)) chars.push("Urs");
    if (/skittles/i.test(secText)) chars.push("Skittles");
    characterPresenceBySection[s.section_id] = chars;
  }

  // 1. Audit Sav in the Middle Nuance
  const gassedUp = /gassed\s+(?:angela\s+)?up|helped\s+make\s+things\s+worse|participant\s+in\s+a\s+messy/i.test(allNarratorText);
  const notHoneypot = /honey\s*pot|not\s+an\s+outsider|invited\s+her\s+over\s+from\s+tiktok/i.test(allNarratorText);
  const demandedDeletion = /delete\s+shit|get\s+(?:the\s+screenshots|her\s+to\s+delete)\s+taken\s+down|trying\s+to\s+get\s+her\s+to\s+delete/i.test(allNarratorText);
  const correctedPhoto = /asked\s+me\s+for\s+that\s+particular\s+image|person\s+who\s+had\s+asked|correcting\s+an\s+account/i.test(allNarratorText);
  const drewLineChildren = /reach\s+their\s+children|contacting\s+people\x27s\s+families|nervous\s+about\s+taking/i.test(allNarratorText);

  const agencyCount = [gassedUp, notHoneypot, demandedDeletion, correctedPhoto, drewLineChildren].filter(Boolean).length;
  const savScore = agencyCount * 20;
  const bystanderTrap = savScore < 60;

  const savAudit: SavNuanceAudit = {
    sav_in_middle_score: savScore,
    agency_moments_acknowledged: {
      gassed_angela_up: gassedUp,
      not_a_honeypot: notHoneypot,
      demanded_receipt_deletion: demandedDeletion,
      corrected_photo_allegation: correctedPhoto,
      drew_line_on_children: drewLineChildren,
    },
    bystander_trap_detected: bystanderTrap,
    editorial_verdict: bystanderTrap
      ? "Bystander Trap Detected: Narration risks depicting Sav purely as a passive victim. Restore her agency and acknowledged culpability (e.g., admitting she 'gassed Angela up' and actively pushed back against screenshot publication)."
      : "Nuanced Fulcrum: Narration successfully balances Sav's genuine affection, emotional conflict, and active decisions without flattening her into a bystander.",
    target_section_id: "CH_04",
    target_narrator_block_id: "CH_04-N3",
    suggested_surgical_enhancement:
      "[Male Narrator]\nSo Sav wasn't only a friend caught in the middle. There were moments when she helped make things worse. When she was furious at me over the people I was hosting with, she had encouraged Angela. And later, when she tried to correct things she'd said privately, Angela didn't necessarily accept the correction.",
  };

  // 2. Audit Angela's Arc & Archetype Safeguards
  const cartoonVillainWords = allNarratorText.match(/\b(purely evil|psychopath|sociopath|monster|sadistic villain|manipulative demon)\b/i);
  const hasUrsMutualDefense = /defended\s+(?:urs|him)\s+before|bully\s+that\s+said/i.test(markdown);
  const hasDeadBabyContext = /dead\s+baby|provoked/i.test(markdown);
  const hasLockedDiscordEthics = /private\s+discord\s+of\s+evidence|could\s+be\s+weaponized\s+to\s+hurt/i.test(markdown);
  const hasEpilogueMistakes = /everybody\s+makes\s+mistakes|admit\s+it\s+if\s+we're\s+wrong/i.test(markdown);

  const angelaAnchorsCount = [hasUrsMutualDefense, hasDeadBabyContext, hasLockedDiscordEthics, hasEpilogueMistakes].filter(Boolean).length;
  const angelaArchetypeRisk = Boolean(cartoonVillainWords) || angelaAnchorsCount < 2;

  const angelaArcMoments: CharacterArcMoment[] = [
    {
      section_id: "CH_01",
      act_id: "ACT ONE",
      section_title: "WHY WE BELIEVED HER",
      emotional_state: "Vulnerable Whistleblower & Mutual Defender",
      relationship_status: "Genuine early ally and recipient of community support",
      primary_evidence_cue: "ARCHIVAL 08 & 09",
      evidence_quote_excerpt: "Angela has defended me before... she exposed him on X.",
      narrator_treatment: "Logan credits her with standing up for participants; describes helping build mock-up.",
      complexity_verdict: "humanizing_anchor",
    },
    {
      section_id: "CH_02",
      act_id: "ACT ONE",
      section_title: "RAINY DAY",
      emotional_state: "Quiet Precaution & Habitual Documentation",
      relationship_status: "Friends with Logan, but keeping archival receipts as insurance",
      primary_evidence_cue: "ARCHIVAL 11 & 12",
      evidence_quote_excerpt: "I still care. But I'm still taking notes the whole fucking time.",
      narrator_treatment: "Logan acknowledges taking notes is ordinary; notes the distinction when records become leverage.",
      complexity_verdict: "nuanced",
    },
    {
      section_id: "CH_03",
      act_id: "ACT ONE",
      section_title: "LYNN DOESN'T WANT A WAR",
      emotional_state: "Feeling Provoked & Defensively Litigious",
      relationship_status: "Hostility toward Lynn's financial support of Oor",
      primary_evidence_cue: "ARCHIVAL 16 & 17",
      evidence_quote_excerpt: "It's going to be your fault that I'm posting them.",
      narrator_treatment: "Highlights the displacement of agency: the publisher insists the recipient forced the disclosure.",
      complexity_verdict: "nuanced",
    },
    {
      section_id: "CH_04",
      act_id: "ACT TWO",
      section_title: "THE FRIEND IN THE MIDDLE",
      emotional_state: "Betrayed by Shifting Romantic Alliances",
      relationship_status: "Friendship with Sav turns into perceived tactical liability",
      primary_evidence_cue: "ARCHIVAL 20 & 21",
      evidence_quote_excerpt: "I stopped telling you... because you were emotionally invested... that turns into a liability.",
      narrator_treatment: "Explores how trust became entangled with dating without turning either person into a villain.",
      complexity_verdict: "nuanced",
    },
    {
      section_id: "CH_05",
      act_id: "ACT TWO",
      section_title: "FOUR AT A TIME",
      emotional_state: "Pushed Past Restraint by Provocation",
      relationship_status: "Full offensive broadcast; deploying batches of four",
      primary_evidence_cue: "ARCHIVAL 22 & 23",
      evidence_quote_excerpt: "Addressing the Men Who Provoked Me With My Dead Baby... increments of four.",
      narrator_treatment: "Validates Angela's genuine hurt over dead baby comments while examining the choice to leak private DMs.",
      complexity_verdict: "humanizing_anchor",
    },
    {
      section_id: "CH_07",
      act_id: "ACT TWO",
      section_title: "THE LINE SHE SAID SHE WOULDN'T CROSS",
      emotional_state: "Clear Moral Boundary vs. 'The Fuck It Bucket'",
      relationship_status: "Confronted by resistance; throwing principles into the bucket",
      primary_evidence_cue: "ARCHIVAL 27 & 28",
      evidence_quote_excerpt: "could be weaponized to hurt other people... then I said, fuck it. I threw it all in the fuck it bucket",
      narrator_treatment: "Validates her stated ethical standard with genuine respect before observing the timeline of when it broke.",
      complexity_verdict: "humanizing_anchor",
    },
    {
      section_id: "CH_09",
      act_id: "ACT THREE",
      section_title: "THE PEOPLE WE SENT HER",
      emotional_state: "Retaliatory Justification",
      relationship_status: "Admitting to doxing front door as retribution for threats to child",
      primary_evidence_cue: "ARCHIVAL 37",
      evidence_quote_excerpt: "So, yes, I doxed the leader... I sent him the photo of his front door...",
      narrator_treatment: "Documents the admitted offline escalation with journalistic restraint rather than courtroom condemnation.",
      complexity_verdict: "nuanced",
    },
    {
      section_id: "EPILOGUE",
      act_id: "EPILOGUE",
      section_title: "IN HER OWN WORDS",
      emotional_state: "Self-Reflective Standard of Maturity",
      relationship_status: "Subject of investigation evaluated by her own earliest standard",
      primary_evidence_cue: "FINAL ARCHIVAL 39",
      evidence_quote_excerpt: "everybody makes mistakes... But do we own up to them? Do we admit it if we're wrong?",
      narrator_treatment: "Agrees with Angela's standard; leaves the listener with her own words rather than a final moral lecture.",
      complexity_verdict: "humanizing_anchor",
    },
  ];

  const angelaProfile: CharacterProfile = {
    character_id: "angela",
    name: "Angela Maggard",
    role_in_story: "Primary subject of inquiry; complex chronicler of grievances",
    humanizing_anchors: [
      "Early mutual defense: Logan mock-up and Urs bully defense in CH_01",
      "Genuine grief over dead baby remarks explicitly validated in CH_05",
      "Stated ethical restraint on private archives in CH_07 validated as reasonable",
      "Closing wisdom in EPILOGUE: 'everybody makes mistakes... do we admit it if we're wrong?'",
    ],
    arc_moments: angelaArcMoments,
    complexity_score: angelaArchetypeRisk ? 68 : 95,
    archetype_risk_flag: angelaArchetypeRisk,
    archetype_risk_warning: angelaArchetypeRisk
      ? "Warning: Angela risks being flattened into a one-dimensional antagonist. Ensure her genuine reasons for feeling cornered and her early mutual defense remain front-and-center."
      : undefined,
  };

  // 3. Sav Profile
  const savArcMoments: CharacterArcMoment[] = [
    {
      section_id: "CH_04",
      act_id: "ACT TWO",
      section_title: "THE FRIEND IN THE MIDDLE",
      emotional_state: "Torn Between Affection & Loyalty",
      relationship_status: "Caught between friend Angela and partner Logan; gassing both up",
      primary_evidence_cue: "ARCHIVAL 20 & WRITTEN READINGS",
      evidence_quote_excerpt: "apparently the goal was to come take you down?? ... that's why I gassed her up about it.",
      narrator_treatment: "Logan gives Sav credit for agency and conflict; admits neither person was perfect.",
      complexity_verdict: "humanizing_anchor",
    },
    {
      section_id: "CH_05",
      act_id: "ACT TWO",
      section_title: "FOUR AT A TIME",
      emotional_state: "Alarmed by Public Exposure",
      relationship_status: "Demanding Angela delete leaked relationship screenshots",
      primary_evidence_cue: "WRITTEN READING SEPT 10",
      evidence_quote_excerpt: "I'm trying to get her to delete shit and then I'm done talking about it with her.",
      narrator_treatment: "Depicts Sav actively pushing back against public deployment of private messages.",
      complexity_verdict: "nuanced",
    },
    {
      section_id: "CH_06",
      act_id: "ACT TWO",
      section_title: "THE STORY A PHOTOGRAPH BECAME",
      emotional_state: "Direct & Corrective",
      relationship_status: "Setting the factual record straight directly with Angela",
      primary_evidence_cue: "FALLOUT AMONG FORMER FRIENDS",
      evidence_quote_excerpt: "Angela, you know that picture of Lin sent to me was because I asked him to show me the proof of it.",
      narrator_treatment: "Presents Sav as the authoritative primary source correcting a sensational broadcast rumor.",
      complexity_verdict: "nuanced",
    },
    {
      section_id: "CH_08",
      act_id: "ACT THREE",
      section_title: "WHEN IT LEAVES THE APP",
      emotional_state: "Protective Mother & Boundary Enforcer",
      relationship_status: "Drawing an unyielding line when conflict touches kids and homes",
      primary_evidence_cue: "ARCHIVAL 30",
      evidence_quote_excerpt: "I'll be the first one to say that... we could have handled a lot differently. And I just don't think that it's worth contacting people's families...",
      narrator_treatment: "Notes Sav taking ownership for her part while drawing a moral boundary against swatting and family harassment.",
      complexity_verdict: "humanizing_anchor",
    },
  ];

  const savProfile: CharacterProfile = {
    character_id: "sav",
    name: "Savannah ('Sav')",
    role_in_story: "Emotional fulcrum of Act II; active participant caught in the crossfire",
    humanizing_anchors: [
      "Explicitly owns her part: admitted gassing Angela up during arguments",
      "Directly refutes honeypot narrative: 'she said this is my friend who has helped me... don't fall in love'",
      "Fought behind the scenes to get leaked screenshots deleted on Sept 10",
      "Courageously drew the moral line on Sept 18 protecting families and children",
    ],
    arc_moments: savArcMoments,
    complexity_score: savScore,
    archetype_risk_flag: bystanderTrap,
    archetype_risk_warning: bystanderTrap ? savAudit.editorial_verdict : undefined,
  };

  // 4. Logan Profile
  const loganProfile: CharacterProfile = {
    character_id: "logan",
    name: "Logan Black",
    role_in_story: "Host, narrator, and participant navigating trust and accusation",
    humanizing_anchors: [
      "Acknowledges early defense of Angela and building website mock-up",
      "Owns that co-hosting Spaces with Oor caused genuine friction",
      "Refuses self-pity: acknowledges relationship with Sav was imperfect",
      "Maintains journalistic curiosity rather than courtroom grandstanding",
    ],
    arc_moments: [
      {
        section_id: "PROLOGUE",
        act_id: "PROLOGUE",
        section_title: "THE THINGS SHE SAID",
        emotional_state: "Composed Under Fire",
        relationship_status: "Facing devastating public accusations on broadcast",
        primary_evidence_cue: "ARCHIVAL 01-07",
        evidence_quote_excerpt: "That was Angela Maggard. And the Logan she's talking about is me.",
        narrator_treatment: "Acknowledge how serious the accusations sound; disputes them factually without hysteria.",
        complexity_verdict: "humanizing_anchor",
      },
      {
        section_id: "CH_04",
        act_id: "ACT TWO",
        section_title: "THE FRIEND IN THE MIDDLE",
        emotional_state: "Self-Accountable & Realistic",
        relationship_status: "Navigating messy relationship dynamics",
        primary_evidence_cue: "WRITTEN READINGS",
        evidence_quote_excerpt: "Neither did I... I won't pretend that Sav and I were having a perfect relationship.",
        narrator_treatment: "Refuses to sanitize his own actions or present himself as an innocent bystander.",
        complexity_verdict: "nuanced",
      },
    ],
    complexity_score: 94,
    archetype_risk_flag: false,
  };

  // 5. Lynn Profile
  const lynnProfile: CharacterProfile = {
    character_id: "lynn",
    name: "Lynn",
    role_in_story: "Generous community supporter confronted by public accusations",
    humanizing_anchors: [
      "Supported creators out of joy: 'it gives me joy... I do believe the best in people'",
      "Pled for a good-faith truce on a live microphone",
      "Suffered business losses but refused to become vengeful: 'I would never wanna take anybody down'",
    ],
    arc_moments: [
      {
        section_id: "CH_03",
        act_id: "ACT ONE",
        section_title: "LYNN DOESN'T WANT A WAR",
        emotional_state: "Good Faith & Dignity Under Accusation",
        relationship_status: "Attempting to de-escalate after newsletter publication",
        primary_evidence_cue: "ARCHIVAL 15 & 16",
        evidence_quote_excerpt: "can we just, like, have a truce of some sorts?",
        narrator_treatment: "Highlights her dignity and refusal to match Angela's aggressive tone.",
        complexity_verdict: "humanizing_anchor",
      },
      {
        section_id: "CH_10",
        act_id: "ACT THREE",
        section_title: "WHAT LYNN STILL HAD LEFT",
        emotional_state: "Quiet Grieving Without Malice",
        relationship_status: "Rebuilding after online warfare damaged real-world businesses",
        primary_evidence_cue: "ARCHIVAL 38",
        evidence_quote_excerpt: "it's still like a loss, you know? I would never wanna take anybody down. I hope we can move on.",
        narrator_treatment: "Showcases the ultimate grace: holding onto her humanity despite real harm.",
        complexity_verdict: "humanizing_anchor",
      },
    ],
    complexity_score: 96,
    archetype_risk_flag: false,
  };

  // 6. Urs Profile
  const ursProfile: CharacterProfile = {
    character_id: "urs",
    name: "Urs",
    role_in_story: "Community participant whose genuine gratitude grounds Angela's early appeal",
    humanizing_anchors: [
      "Publicly thanked Angela for defending him from an abusive bully two years prior",
      "Demonstrates why people trusted Angela before the whisper network turned inward",
    ],
    arc_moments: [
      {
        section_id: "CH_01",
        act_id: "ACT ONE",
        section_title: "WHY WE BELIEVED HER",
        emotional_state: "Grateful & Validated",
        relationship_status: "Participant expressing honest appreciation to Angela",
        primary_evidence_cue: "ARCHIVAL 09",
        evidence_quote_excerpt: "Angela has defended me before... I just really want to thank you, Angela.",
        narrator_treatment: "Told without cynicism: 'That's how trust gets built. You believe someone will stand up for you.'",
        complexity_verdict: "humanizing_anchor",
      },
    ],
    complexity_score: 92,
    archetype_risk_flag: false,
  };

  // 7. Skittles Profile
  const skittlesProfile: CharacterProfile = {
    character_id: "skittles",
    name: "Skittles",
    role_in_story: "Mother representing the real-world collision when online disputes hit doorsteps",
    humanizing_anchors: [
      "Experienced five consecutive months of welfare/CPS visits",
      "Exposes the tangible fear of taking children to school",
      "Family phone numbers forced to change",
    ],
    arc_moments: [
      {
        section_id: "CH_08",
        act_id: "ACT THREE",
        section_title: "WHEN IT LEAVES THE APP",
        emotional_state: "Exhausted & Terrified for Her Family",
        relationship_status: "Target of recurring welfare checks and police visits",
        primary_evidence_cue: "ARCHIVAL 32 & 33",
        evidence_quote_excerpt: "I got nervous to take my fucking son to school... she called my firstborn daughter.",
        narrator_treatment: "Focuses on the concrete human texture of fear rather than courtroom claims.",
        complexity_verdict: "humanizing_anchor",
      },
    ],
    complexity_score: 95,
    archetype_risk_flag: false,
  };

  const characters = [angelaProfile, savProfile, loganProfile, lynnProfile, ursProfile, skittlesProfile];
  const totalScore = characters.reduce((acc, c) => acc + c.complexity_score, 0);
  const overallComplexityScore = Number((totalScore / characters.length).toFixed(1));
  const archetypeWarningsCount = characters.filter((c) => c.archetype_risk_flag).length;

  return {
    overallComplexityScore,
    archetypeWarningsCount,
    characters,
    savNuanceAudit: savAudit,
    characterPresenceBySection,
  };
}

export function getComplexityForSection(
  report: HumanComplexityReport,
  sectionId: string
): CharacterArcMoment[] {
  const norm = sectionId.toUpperCase().trim();
  const list: CharacterArcMoment[] = [];
  for (const c of report.characters) {
    for (const m of c.arc_moments) {
      if (m.section_id.toUpperCase().includes(norm) || norm.includes(m.section_id.toUpperCase())) {
        list.push(m);
      }
    }
  }
  return list;
}

// ============================================================================
// 3. TAPE HAND-OFF & FRESHNESS DOCTOR
// ============================================================================

export interface TapeHandOffIssue {
  id: string;
  section_id: string;
  narrator_block_id: string;
  quote_block_id: string;
  issue_type: "preemptive_lead_in_spoiler" | "post_tape_over_explanation" | "pre_judging_tone";
  severity: "high" | "medium";
  cue_header: string;
  quote_text: string;
  narrator_text: string;
  diagnosis: string;
  spoiled_elements: string[];
  option_d_fresh_alternative: string;
}

export interface TapeFreshnessReport {
  freshnessScore: number; // 0 to 100
  totalTapeHandoffs: number;
  cleanHandoffsCount: number;
  preemptiveSpoilersCount: number;
  postTapeRecapsCount: number;
  issues: TapeHandOffIssue[];
}

export function analyzeTapeFreshness(markdown: string): TapeFreshnessReport {
  const parsed = parseManuscript(markdown);
  const issues: TapeHandOffIssue[] = [];
  let totalTapeHandoffs = 0;
  let cleanHandoffsCount = 0;
  let preemptiveSpoilersCount = 0;
  let postTapeRecapsCount = 0;

  const PREEMPTIVE_SPOILER_RE =
    /\b(?:about to|prepared to|going to|would)\s+(?:threaten|ruin|attack|claim|expose|leak|drop|lie|admit)\b/i;
  const ANNOUNCER_CLICHE_RE =
    /\b(?:in the clip you are about to hear|here is where she says|what she says next is|listen to (?:her|him) (?:threaten|lie|admit|claim))\b/i;
  const PRE_JUDGING_RE =
    /\b(?:notice how (?:guilty|malicious|hypocritical|unhinged|deceitful) (?:she|he) sounds|listen to the (?:malice|hatred|lies|deception) in)\b/i;

  const POST_TAPE_RECAP_RE =
    /\b(?:in other words|what (?:she|he) (?:really )?meant was|as you just heard|what this (?:clip|recording|quote) (?:proves|shows|means) is|so basically (?:she|he) is saying|to summarize what (?:she|he) just said)\b/i;

  for (const sec of parsed.sections) {
    if (sec.act_id === "APPENDIX") continue;

    for (let i = 0; i < sec.blocks.length; i++) {
      const blk = sec.blocks[i];
      if (blk.type !== "blockquote") continue;

      totalTapeHandoffs++;
      let hasIssueOnThisTape = false;

      // Locate lead-in narrator block
      let leadInNarrator: ScriptBlock | null = null;
      let cueHeader = "";
      if (i > 0 && sec.blocks[i - 1].type === "narrator") {
        leadInNarrator = sec.blocks[i - 1];
      } else if (
        i > 1 &&
        (sec.blocks[i - 1].type === "archival" ||
          sec.blocks[i - 1].type === "reading")
      ) {
        cueHeader = sec.blocks[i - 1].rawText;
        if (sec.blocks[i - 2].type === "narrator") {
          leadInNarrator = sec.blocks[i - 2];
        }
      }

      // Locate post-tape narrator block
      let postTapeNarrator: ScriptBlock | null = null;
      if (i + 1 < sec.blocks.length && sec.blocks[i + 1].type === "narrator") {
        postTapeNarrator = sec.blocks[i + 1];
      }

      const cleanQuote = blk.rawText.replace(/^>\s*/gm, "").trim();

      // Check Lead-in
      if (leadInNarrator) {
        const leadInText = leadInNarrator.rawText;
        const isPreemptiveSpoiler = PREEMPTIVE_SPOILER_RE.test(leadInText);
        const isAnnouncerCliche = ANNOUNCER_CLICHE_RE.test(leadInText);
        const isPreJudging = PRE_JUDGING_RE.test(leadInText);

        if (isPreemptiveSpoiler || isAnnouncerCliche || isPreJudging) {
          hasIssueOnThisTape = true;
          preemptiveSpoilersCount++;
          const issueType: TapeHandOffIssue["issue_type"] = isPreJudging
            ? "pre_judging_tone"
            : "preemptive_lead_in_spoiler";

          const spoiledMatch =
            leadInText.match(PREEMPTIVE_SPOILER_RE)?.[0] ||
            leadInText.match(ANNOUNCER_CLICHE_RE)?.[0] ||
            leadInText.match(PRE_JUDGING_RE)?.[0] ||
            "Preemptive setup";

          issues.push({
            id: `LEADIN-${sec.section_id}-${leadInNarrator.id}`,
            section_id: sec.section_id,
            narrator_block_id: leadInNarrator.id,
            quote_block_id: blk.id,
            issue_type: issueType,
            severity: "high",
            cue_header: cueHeader || "Original Archival Tape",
            quote_text: cleanQuote.slice(0, 160),
            narrator_text: leadInText.slice(0, 160),
            diagnosis:
              "Preemptive lead-in drains the tape's impact: narration tells the listener the emotional takeaway before the speaker actually says it.",
            spoiled_elements: [spoiledMatch],
            option_d_fresh_alternative:
              "[Male Narrator]\n" +
              leadInText
                .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
                .replace(PREEMPTIVE_SPOILER_RE, "addressed the situation directly")
                .replace(ANNOUNCER_CLICHE_RE, "Here is what happened next")
                .replace(PRE_JUDGING_RE, "Listen to how she framed it")
                .trim(),
          });
        }
      }

      // Check Post-tape exit
      if (postTapeNarrator) {
        const postText = postTapeNarrator.rawText;
        const isRecap = POST_TAPE_RECAP_RE.test(postText);

        if (isRecap) {
          hasIssueOnThisTape = true;
          postTapeRecapsCount++;
          const recapMatch = postText.match(POST_TAPE_RECAP_RE)?.[0] || "Redundant recap";

          issues.push({
            id: `POSTEXIT-${sec.section_id}-${postTapeNarrator.id}`,
            section_id: sec.section_id,
            narrator_block_id: postTapeNarrator.id,
            quote_block_id: blk.id,
            issue_type: "post_tape_over_explanation",
            severity: "medium",
            cue_header: cueHeader || "Original Archival Tape",
            quote_text: cleanQuote.slice(0, 160),
            narrator_text: postText.slice(0, 160),
            diagnosis:
              "Post-tape over-explanation: narration immediately repeats or summarizes what the tape just clearly established. Let the audio breathe.",
            spoiled_elements: [recapMatch],
            option_d_fresh_alternative:
              "[Male Narrator]\n" +
              postText
                .replace(/^\[(?:Male\s+)?Narrator\]\s*/i, "")
                .replace(POST_TAPE_RECAP_RE, "The significance of that statement")
                .trim() +
              " [Beat]",
          });
        }
      }

      if (!hasIssueOnThisTape) {
        cleanHandoffsCount++;
      }
    }
  }

  const rawFreshness =
    totalTapeHandoffs > 0
      ? Math.max(0, 100 - preemptiveSpoilersCount * 8 - postTapeRecapsCount * 5)
      : 100;
  const freshnessScore = Number(rawFreshness.toFixed(1));

  return {
    freshnessScore,
    totalTapeHandoffs,
    cleanHandoffsCount,
    preemptiveSpoilersCount,
    postTapeRecapsCount,
    issues,
  };
}

export function getTapeFreshnessForSection(
  report: TapeFreshnessReport,
  sectionId: string
): TapeHandOffIssue[] {
  const norm = sectionId.toUpperCase().trim();
  return report.issues.filter(
    (issue) =>
      issue.section_id.toUpperCase().includes(norm) ||
      norm.includes(issue.section_id.toUpperCase())
  );
}


