/**
 * Project knowledge expressed as reusable DATA rather than application logic.
 * The narrative engine derives scenes, speakers, and order from the manuscript itself;
 * this file only supplies aliases, a glossary of insider terms, and opening hypotheses.
 * A different documentary can supply its own ProjectKnowledgeBase without code changes.
 */

export interface GlossaryTerm {
  term: string;
  /** Regex source (case-insensitive) that detects the term in spoken text. */
  pattern: string;
  category: "platform" | "jargon" | "legal" | "show_title" | "username";
  plain_meaning: string;
}

export interface GatewayDefinition {
  id: string;
  label: string;
  /** Creative hypothesis being tested. Never treated as a predetermined improvement. */
  hypothesis: string;
  /**
   * Distinctive snippets of existing tape quotes that should lead the opening, in order.
   * Each snippet must be found in the opening scene, or the gateway is reported unavailable.
   * An empty list means "the current draft".
   */
  lead_quote_snippets: string[];
}

export interface ProjectKnowledgeBase {
  project_id: string;
  title: string;
  /** First-person narrator name. "I" and "me" in narration refer to this person. */
  narrator_name: string;
  /** Lowercase spelling variants mapped to a canonical name (transcription variants, nicknames). */
  name_aliases: Record<string, string>;
  /** People who are named in tape or narration but are not cue-header speakers. */
  additional_named_people: string[];
  glossary: GlossaryTerm[];
  gateways: GatewayDefinition[];
  listener_persona: string;
}

export const PAPER_TRAIL_KNOWLEDGE: ProjectKnowledgeBase = {
  project_id: "the-paper-trail",
  title: "THE PAPER TRAIL",
  narrator_name: "Logan",
  name_aliases: {
    orr: "Oor",
    oor: "Oor",
    linn: "Lynn",
    lin: "Lynn",
    lynn: "Lynn",
    "angela maggard": "Angela",
  },
  additional_named_people: ["Chrissy", "Detective Zaddy", "SaraBeth"],
  glossary: [
    // Only terms an intelligent outsider would plausibly not know. Everyday words (DM, newsletter) are excluded.
    { term: "Spaces", pattern: "\\bspaces?\\b", category: "platform", plain_meaning: "Live audio chat rooms on X (formerly Twitter)." },
    { term: "Discord", pattern: "\\bdiscord\\b", category: "platform", plain_meaning: "A separate chat app with private servers." },
    { term: "receipts", pattern: "\\breceipts\\b", category: "jargon", plain_meaning: "Saved screenshots or records used as proof in an argument." },
    { term: "clipping", pattern: "\\bclipping\\b", category: "jargon", plain_meaning: "Recording short excerpts of live audio to repost." },
    { term: "platforming", pattern: "\\bplatform(?:ed|ing|s)?\\b", category: "jargon", plain_meaning: "Giving someone a stage or audience." },
    { term: "doxing", pattern: "\\bdox(?:ed|xed|ing|xing)?\\b", category: "jargon", plain_meaning: "Publishing someone's private identifying details." },
    { term: "swatted", pattern: "\\bswatt?ed\\b", category: "jargon", plain_meaning: "Having authorities sent to your home on a report." },
    { term: "honey pot", pattern: "\\bhoney ?pot\\b", category: "jargon", plain_meaning: "Someone sent to get close to a person to gather information." },
    { term: "discovery", pattern: "\\bdiscovery\\b", category: "legal", plain_meaning: "The legal process of exchanging evidence in a lawsuit." },
    { term: "CPS", pattern: "\\b(?:c ?p ?s|child (?:protective )?services)\\b", category: "legal", plain_meaning: "Child Protective Services, a child welfare agency." },
  ],
  gateways: [
    {
      id: "A",
      label: "Gateway A: Allegations First (Current Draft)",
      hypothesis: "Opening on the accusations creates immediate stakes and lets the narrator's first words reframe them.",
      lead_quote_snippets: [],
    },
    {
      id: "B",
      label: "Gateway B: The Friendship First (Emotional Grounding)",
      hypothesis: "Hearing the friendship before the accusations may let a new listener feel the loss of trust before judging the conflict.",
      lead_quote_snippets: ["So Logan was the second space"],
    },
    {
      id: "C",
      label: "Gateway C: The Ticking Clock (Digital Surveillance Theme)",
      hypothesis: "Leading with the archive of screenshots may frame the story around what happens to shared information, before any accusation.",
      lead_quote_snippets: ["I screenshot in real time", "here's the next four screenshots"],
    },
  ],
  listener_persona:
    "An intelligent adult podcast listener who has never heard of Angela, Logan, Sav, X Spaces, or this controversy. They only know what the audio has told them so far.",
};
