// Bib numbers are three digits on the race's own paperwork and on W100's
// screens, so runner 1 is "001" there. Rendering a bare "1" next to a "153"
// makes a volunteer read the column twice.

export function formatBib(bib: number): string {
  return String(bib).padStart(3, "0");
}
