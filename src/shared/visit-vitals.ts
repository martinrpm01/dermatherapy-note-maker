import { createEmptyVitals, formatVitals, shouldIncludeExamVitals } from "./note-rules";
import type { NoteType, Vitals } from "./types";

function visitFamily(noteType: NoteType) {
  return noteType === "consult_sim" || noteType === "follow_up" ? noteType : "treatment";
}

/** Changing the kind of visit starts fresh vitals; editing the same treatment visit does not. */
export function resetVitalsForVisitTypeChange(previousType: NoteType, nextType: NoteType, vitals: Vitals): Vitals {
  return visitFamily(previousType) === visitFamily(nextType) ? { ...vitals } : createEmptyVitals();
}

const vitalFields: Array<{ key: keyof Vitals; label: string; reading: RegExp }> = [
  { key: "bloodPressure", label: "Blood Pressure", reading: /^[-+]?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?(?:\s*(?:mm\s*h[gG]|mmgh))?(?=$|[\s,;.!()-])/i },
  { key: "heartRate", label: "Heart Rate", reading: /^[-+]?\d+(?:\.\d+)?(?:\s*bpm)?(?=$|[\s,;.!()-])/i },
  { key: "pulse", label: "Pulse", reading: /^[-+]?\d+(?:\.\d+)?(?:\s*bpm)?(?=$|[\s,;.!()-])/i },
  { key: "oxygenSaturation", label: "Oxygen Saturation", reading: /^[-+]?\d+(?:\.\d+)?(?:\s*%+)?(?=$|[\s,;.!()-])/i },
  { key: "weight", label: "Weight", reading: /^[-+]?\d+(?:\.\d+)?(?:\s*lbs?)?(?=$|[\s,;.!()-])/i }
];
const headerPattern = /^\s*Exam Vitals:\s*$/;
const vitalLinePattern = /^\s*(Blood Pressure|Heart Rate|Pulse|Oxygen Saturation|Weight):[ \t]*(.*)$/;
const sectionHeaderPattern = /^\s*[A-Za-z][A-Za-z /&()-]+:\s*$/;
const missingReadingPattern = /^(?:n\/?a|not (?:taken|measured|obtained|recorded)|unable(?: to (?:obtain|measure))?|declined|refused|unknown|unavailable|not available|--?)(?:\s*(?:mm\s*hg|bpm|%|lbs?))?(?=$|[\s,;.!()])/i;

type VitalsBlock = { start: number; end: number; narrative: string[] };

function findVitalsBlocks(lines: string[]): VitalsBlock[] {
  const blocks: VitalsBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!headerPattern.test(lines[index])) continue;
    const start = index;
    const narrative: string[] = [];
    let end = index + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (headerPattern.test(line)) break;
      const match = line.match(vitalLinePattern);
      if (!match) {
        if (sectionHeaderPattern.test(line)) break;
        // Blank space ends the canonical section unless another canonical vital follows it.
        if (!line.trim()) {
          let next = end + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (!vitalLinePattern.test(lines[next] ?? "")) break;
        }
        narrative.push(line);
        end += 1;
        continue;
      }
      const field = vitalFields.find((item) => item.label === match[1])!;
      const value = match[2].trim();
      if (value) {
        const reading = value.match(field.reading) ?? value.match(missingReadingPattern);
        if (reading) {
          // Keep any clinician narrative after the numeric reading, including unrelated numbers.
          const suffix = value.slice(reading[0].length).trim();
          if (suffix) narrative.push(suffix);
        } else {
          // A hand-written sentence is not a structured reading; leave its wording intact.
          narrative.push(line);
        }
      }
      end += 1;
    }
    blocks.push({ start, end, narrative });
    index = end - 1;
  }
  return blocks;
}

function insertionIndex(editedLines: string[], generatedText: string) {
  const generatedLines = generatedText.replace(/\r\n/g, "\n").split("\n");
  const generatedBlock = findVitalsBlocks(generatedLines)[0];
  if (generatedBlock) {
    // The first following generated line can be a section heading or a numbered lesion.
    for (let index = generatedBlock.end; index < generatedLines.length; index += 1) {
      const anchor = generatedLines[index].trim();
      if (!anchor) continue;
      const match = editedLines.findIndex((line) => line.trim() === anchor);
      if (match >= 0) return match;
      if (sectionHeaderPattern.test(anchor)) break;
    }
  }
  const impression = editedLines.findIndex((line) => /^\s*Impression\s*\/\s*Plan(?: Comments)?:\s*$/i.test(line));
  if (impression >= 0) return impression;
  const examComment = editedLines.findIndex((line) => /^\s*Exam Comment:\s*$/i.test(line));
  if (examComment >= 0) {
    let end = examComment + 1;
    while (end < editedLines.length && editedLines[end].trim() && !sectionHeaderPattern.test(editedLines[end])) end += 1;
    return end;
  }
  return editedLines.length;
}

/** Keep only this visit's structured readings in the canonical vitals section of manually edited text. */
export function syncEditedVisitVitals(editedText: string, generatedText: string, noteType: NoteType, vitals: Vitals): string {
  // An empty override means the renderer uses the complete generated note, not a vitals-only override.
  if (!editedText.trim()) return editedText;
  const newline = editedText.includes("\r\n") ? "\r\n" : "\n";
  const lines = editedText.replace(/\r\n/g, "\n").split("\n");
  const formatted = formatVitals(vitals);
  const readings = shouldIncludeExamVitals(noteType, true)
    ? vitalFields.flatMap(({ key, label }) => formatted[key] ? [`${label}: ${formatted[key]}`] : [])
    : [];
  const replacement = readings.length ? ["Exam Vitals:", ...readings] : [];
  const blocks = findVitalsBlocks(lines);
  if (blocks.length) {
    // Collapse duplicate canonical sections while keeping all custom narrative.
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      lines.splice(block.start, block.end - block.start, ...(index === 0 ? replacement : []), ...block.narrative);
    }
  } else if (replacement.length) {
    const index = insertionIndex(lines, generatedText);
    const before = index > 0 && lines[index - 1].trim() ? [""] : [];
    const after = index < lines.length && lines[index].trim() ? [""] : [];
    lines.splice(index, 0, ...before, ...replacement, ...after);
  }
  return lines.join(newline);
}
