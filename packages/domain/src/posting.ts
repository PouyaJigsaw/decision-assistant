export type JobPosting = {
  title: string;
  company: string;
  summary: string;
};

const SUMMARY_LIMIT = 160;
const SKIP_LINE =
  /^(about the job|about the company|see how you compare|people also viewed|similar jobs|show more|show less|apply|save|follow)$/i;

export function parseJobPosting(notes: string): JobPosting {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !SKIP_LINE.test(line));
  const blob = lines.join(" ");

  const dotIdx = lines.findIndex((line) => line.includes(" · "));
  let title = "";
  let company = "";
  if (dotIdx >= 0) {
    company = lines[dotIdx]?.split(" · ")[0]?.trim() ?? "";
    title = (dotIdx > 0 ? lines[dotIdx - 1] : "") || titleFromLooking(blob);
  }

  if (!company) {
    const at = (lines[0] ?? "").match(/\bat\s+(.+)$/i);
    company = at?.[1]?.replace(/\s+[·|].*$/, "").trim() ?? companyFromLead(blob);
  }
  if (!title) title = titleFromLooking(blob) || firstSentence(lines[0] ?? "") || "Role";

  const summary = blob.slice(0, SUMMARY_LIMIT);
  return { title: title.slice(0, 80), company, summary };
}

const NOT_A_NAME =
  /^(about|experience|education|skills|headline|activity|analytics|featured|projects|publications|languages|recommendations|honors|volunteering)$/i;

export function candidateNameFromPageTitle(title: string): string {
  const match = title.match(/^(.+?)\s*[|·–-]\s*LinkedIn\s*$/im);
  return asPersonName(match?.[1] ?? "");
}

export function candidateNameFromApprovedText(text: string): string {
  const match = text.match(/^Headline\s*\n([^\n]+)/m);
  if (match) {
    const fromLine = asPersonName(match[1]?.split(/\s+[—–-]\s+/)[0] ?? "");
    if (fromLine) return fromLine;
  }
  return candidateNameFromPageTitle(text);
}

export function asPersonName(value: string): string {
  const name = dedupeRepeatedName(value.replace(/\s+/g, " ").trim());
  if (!name || NOT_A_NAME.test(name)) return "";
  const words = name.split(" ");
  if (words.length < 1 || words.length > 6) return "";
  const ok = words.every(
    (word) => /^[\p{L}][\p{L}'’.-]*$/u.test(word) && word[0] === word[0].toLocaleUpperCase(),
  );
  return ok ? name : "";
}

function dedupeRepeatedName(value: string): string {
  const words = value.split(" ");
  const half = Math.floor(words.length / 2);
  if (half > 0 && words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
    return words.slice(0, half).join(" ");
  }
  return value;
}

function firstSentence(line: string): string {
  return (line.split(".")[0]?.trim() ?? line).slice(0, 80);
}

function titleFromLooking(blob: string): string {
  const looking = blob.match(/looking for ([^.]+?)(?:\s+\(| who |,|\.)/i);
  if (looking?.[1]) return looking[1].replace(/\s+/g, " ").trim();
  const asA = blob.match(/\bAs an? ([^,]+?),/i);
  return asA?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function companyFromLead(blob: string): string {
  const lead = blob.match(/^([A-Z][A-Za-z0-9&.]{1,40}?)(?:\s+is a|\s+is an|\s+partners)\b/);
  return lead?.[1]?.trim() ?? "";
}
