/**
 * Strip markdown formatting from text, producing clean English sentences.
 * Handles both raw markdown and partially-cleaned content (e.g. source labels
 * left over from [link](url) → "link" conversion).
 */
export function stripMarkdown(text: string): string {
  let cleaned = text;

  // 1. Remove markdown links at the start entirely (source labels are useless)
  //    e.g. "[linkedin](https://...)" → ""
  cleaned = cleaned.replace(/^\s*\[([^\]]*)\]\([^)]*\)\s*/g, "");
  // Remove remaining inline markdown links: [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 2. Remove standalone URLs anywhere
  cleaned = cleaned.replace(/https?:\/\/[^\s)]+/g, "");

  // 3. Remove markdown headers ANYWHERE (not just line-start; content is single-line)
  cleaned = cleaned.replace(/#{1,6}\s+/g, "");

  // 4. Remove bold/italic: **text** or *text* → text
  cleaned = cleaned.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");

  // 5. Remove inline code backticks
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // 6. Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 7. Remove empty parentheses left from URL removal
  cleaned = cleaned.replace(/\(\s*\)/g, "").trim();

  // 8. Remove leading bullet/dash marker: "- item" → "item"
  cleaned = cleaned.replace(/^\s*[-*+]\s+/, "").trim();

  // 9. Remove leading source-label-like tokens (domain patterns with dots)
  //    e.g. "openjobs-ai.gitbook", "the-vision-debugged.beehiiv"
  //    Must contain at least one dot to avoid stripping valid hyphenated words like "well-known"
  cleaned = cleaned.replace(/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)+\s+/i, "").trim();

  // 10. After removing source label, there might be another "## " or "- "
  cleaned = cleaned.replace(/^#{1,6}\s+/, "").trim();
  cleaned = cleaned.replace(/^\s*[-*+]\s+/, "").trim();

  // 11. Handle single-word source labels without dots/hyphens
  //     (e.g. "linkedin", "producthunt", "webcatalog")
  //     Strip if all-lowercase word followed by uppercase word or "- "
  cleaned = cleaned.replace(/^[a-z]{2,20}\s+(?=[A-Z])/, "").trim();
  cleaned = cleaned.replace(/^[a-z]{2,20}\s+(?=[-*+]\s)/, "").trim();
  // After removing the label, strip the "- " again
  cleaned = cleaned.replace(/^\s*[-*+]\s+/, "").trim();

  return cleaned;
}

// Language detection: returns true if text is primarily English
export function isEnglish(text: string): boolean {
  // Remove common punctuation and numbers
  const cleaned = text.replace(/[0-9\s\p{P}]/gu, "");
  if (cleaned.length === 0) return false;

  // Count Latin characters
  const latinChars = cleaned.replace(/[^a-zA-Z]/g, "").length;
  const ratio = latinChars / cleaned.length;

  return ratio > 0.5;
}

// Split text into sentences
export function splitSentences(text: string): string[] {
  // Normalize whitespace
  let normalized = text.replace(/\s+/g, " ").trim();

  // Protect common abbreviations from being split
  const abbreviations = [
    "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.",
    "U.S.", "U.K.", "U.N.", "E.U.",
    "a.m.", "p.m.", "A.M.", "P.M.",
    "e.g.", "i.e.", "etc.", "vs.",
    "Inc.", "Ltd.", "Corp.", "Co.",
    "St.", "Ave.", "Blvd.", "Rd.",
    "Jan.", "Feb.", "Mar.", "Apr.", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec.",
    "Fig.", "No.", "Vol.",
  ];

  // Replace abbreviation periods with a placeholder
  const placeholder = "\u0000";
  for (const abbr of abbreviations) {
    const escaped = abbr.replace(/\./g, "\\.");
    normalized = normalized.replace(
      new RegExp(escaped, "g"),
      abbr.replace(/\./g, placeholder)
    );
  }

  // Also protect decimal numbers like 3.14
  normalized = normalized.replace(/(\d)\.(\d)/g, `$1${placeholder}$2`);

  // Split on sentence-ending punctuation
  const raw = normalized.split(/(?<=[.!?])\s+/);

  // Restore placeholders
  const sentences = raw
    .map((s) => s.replace(new RegExp(placeholder, "g"), ".").trim())
    .filter((s) => s.length > 0);

  return sentences;
}

// Check for duplicate content in user's corpus
export async function checkDuplicates(
  db: D1Database,
  userId: string,
  sentences: string[]
): Promise<{ unique: string[]; duplicates: string[] }> {
  if (sentences.length === 0) return { unique: [], duplicates: [] };

  // Batch check using D1 batch API to avoid N+1 queries
  const statements = sentences.map((sentence) =>
    db
      .prepare("SELECT id FROM materials WHERE user_id = ? AND content = ?")
      .bind(userId, sentence)
  );

  const results = await db.batch(statements);

  const unique: string[] = [];
  const duplicates: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const rows = results[i].results;
    if (rows && rows.length > 0) {
      duplicates.push(sentences[i]);
    } else {
      unique.push(sentences[i]);
    }
  }

  return { unique, duplicates };
}
