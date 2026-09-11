// The diff: how one aid station's Tracer times line up against W100's.
//
// In-times and out-times are tracked as separate work items, because a runner
// can easily have their arrival recorded in W100 but not their departure, and
// the volunteer needs to know which of the two to type.
//
// Every Tracer time lands in exactly one of four places:
//
//   toEnter    W100 does not have it and someone can type it right now
//   missingIn  an out-time W100 will not show us, because it has no in-time
//              for that runner yet -- another team's job, not this queue's
//   misaligned both sides have the time and they disagree
//   nowhere    both sides have it and they agree; the work is done
//
// `missingIn` exists because of a quirk worth stating plainly:
// /aid-station/{id}/times omits a runner entirely when their ElapsedTimeIn is
// -1, even when an out-time is recorded. So a bib missing from that response
// is not "W100 has nothing" -- it is "W100 has no in-time", and its out-time
// is simply invisible to us. Queueing those as work produced a list of runners
// whose times had already been entered. Use getRunnerTimes(bib) to see the
// truth for one runner.
//
// Pure and fetch-free so it can be tested against either live API with the
// other side mocked.

import type { Entry, Participant, Station } from "./tracer";
import type { W100RunnerTimes } from "./w100";
import { indexStationTimes } from "./w100";
import { elapsedSeconds } from "./time";

export type TimeKind = "in" | "out";

export interface StationRow {
  /** Stable identity for dismissal storage: `${bib}-${kind}`. */
  key: string;
  bib: number;
  kind: TimeKind;
  /** Tracer's ISO instant for this time. */
  iso: string;
  /** Tracer's time as seconds from race start, or null when it is unknown. */
  tracerElapsed: number | null;
  /** W100's elapsed seconds for this kind, or null when W100 does not have it. */
  w100Elapsed: number | null;
  runnerName: string | null;
}

export interface DiffInput {
  entries: Entry[];
  participants: Participant[];
  station: Pick<Station, "id">;
  /** W100 rows for this station, or null when W100 could not be reached. */
  w100Rows: W100RunnerTimes[] | null;
  /** Race start as epoch ms, from W100's status. Null leaves times uncompared. */
  raceStartMs?: number | null;
}

export interface DiffResult {
  /** Times a volunteer can enter into W100 right now. */
  toEnter: StationRow[];
  /** Out-times blocked behind a missing W100 in-time. */
  missingIn: StationRow[];
  /** Times both sides have, but with different values. */
  misaligned: StationRow[];
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

// Bib ascending, and within a bib the arrival before the departure -- that is
// the order a volunteer reads their own paper log in. Ranked explicitly rather
// than by comparing the strings: "in" < "out" alphabetically is a coincidence,
// and a third kind would silently land wherever its name fell.
const kindRank: Record<TimeKind, number> = { in: 0, out: 1 };

export function byBibThenKind(a: StationRow, b: StationRow): number {
  return a.bib === b.bib ? kindRank[a.kind] - kindRank[b.kind] : a.bib - b.bib;
}

export function diffStation({
  entries,
  participants,
  station,
  w100Rows,
  raceStartMs = null,
}: DiffInput): DiffResult {
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const degraded = w100Rows === null;
  const w100 = degraded ? null : indexStationTimes(w100Rows!);

  const toEnter: StationRow[] = [];
  const missingIn: StationRow[] = [];
  const misaligned: StationRow[] = [];
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

      const recorded = w100?.byBib.get(bib);
      const w100Elapsed = (kind === "in" ? recorded?.in : recorded?.out) ?? null;
      const tracerElapsed = raceStartMs === null ? null : elapsedSeconds(iso, raceStartMs);
      const row: StationRow = { key: `${bib}-${kind}`, bib, kind, iso, tracerElapsed, w100Elapsed, runnerName: name };

      if (w100Elapsed !== null) {
        // Without a race start there is nothing to compare against, so a time
        // W100 already holds is treated as done rather than guessed at.
        if (tracerElapsed !== null && tracerElapsed !== w100Elapsed) misaligned.push(row);
        continue;
      }

      // An out-time W100 cannot show us is not this queue's work. An in-time
      // always is: it is the entry that unblocks everything else.
      if (!degraded && kind === "out" && (recorded?.in ?? null) === null) {
        missingIn.push(row);
        continue;
      }

      toEnter.push(row);
    }
  }

  toEnter.sort(byBibThenKind);
  missingIn.sort(byBibThenKind);
  misaligned.sort(byBibThenKind);
  return { toEnter, missingIn, misaligned, degraded, tracerTimeCount };
}
