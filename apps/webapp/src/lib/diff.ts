// The diff: which times exist in Tracer for one aid station but not in W100.
//
// In-times and out-times are tracked as separate work items, because a runner
// can easily have their arrival recorded in W100 but not their departure, and
// the volunteer needs to know which of the two to type.
//
// Pure and fetch-free so it can be tested against either live API with the
// other side mocked.

import type { Entry, Participant, Station } from "./tracer";
import type { W100RunnerTimes } from "./w100";
import { indexStationTimes } from "./w100";

export type TimeKind = "in" | "out";

export interface MissingTime {
  /** Stable identity for dismissal storage: `${bib}-${kind}`. */
  key: string;
  bib: number;
  kind: TimeKind;
  /** Tracer's ISO instant for this time. */
  iso: string;
  runnerName: string | null;
}

export interface DiffInput {
  entries: Entry[];
  participants: Participant[];
  station: Pick<Station, "id">;
  /** W100 rows for this station, or null when W100 could not be reached. */
  w100Rows: W100RunnerTimes[] | null;
}

export interface DiffResult {
  missing: MissingTime[];
  /** True when W100 was unreachable and every Tracer time is listed unverified. */
  degraded: boolean;
  /** Tracer times found at this station, whether or not W100 already has them. */
  tracerTimeCount: number;
}

function runnerName(p: Participant | undefined): string | null {
  if (!p) return null;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
}

export function diffStation({
  entries,
  participants,
  station,
  w100Rows,
}: DiffInput): DiffResult {
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const degraded = w100Rows === null;
  const w100 = degraded ? null : indexStationTimes(w100Rows!);

  const missing: MissingTime[] = [];
  let tracerTimeCount = 0;

  for (const entry of entries) {
    if (entry.stationId !== station.id) continue;

    const participant = participantById.get(entry.participantId);
    // Without a participant there is no bib to show, so the row is unusable.
    if (!participant) continue;

    const bib = participant.bibNumber;
    const name = runnerName(participant);

    // `timeOut` is absent entirely on some live Tracer entries, so it is read
    // defensively rather than assumed present.
    const times: [TimeKind, string | null][] = [
      ["in", entry.timeIn ?? null],
      ["out", entry.timeOut ?? null],
    ];

    for (const [kind, iso] of times) {
      if (!iso) continue;
      tracerTimeCount += 1;

      if (w100) {
        const recorded = w100.byBib.get(bib);
        const alreadyThere = kind === "in" ? recorded?.in : recorded?.out;
        if (alreadyThere != null) continue;
      }

      missing.push({ key: `${bib}-${kind}`, bib, kind, iso, runnerName: name });
    }
  }

  // Bib ascending, and within a bib the arrival before the departure -- that
  // is the order a volunteer reads their own paper log in. Ranked explicitly
  // rather than by comparing the strings: "in" < "out" alphabetically is a
  // coincidence, and a third kind would silently land wherever its name fell.
  const kindRank: Record<TimeKind, number> = { in: 0, out: 1 };
  missing.sort((a, b) => (a.bib === b.bib ? kindRank[a.kind] - kindRank[b.kind] : a.bib - b.bib));
  return { missing, degraded, tracerTimeCount };
}
