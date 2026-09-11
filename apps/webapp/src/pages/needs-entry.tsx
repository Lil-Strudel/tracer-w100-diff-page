import {
  type Component,
  type JSX,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
  batch,
} from "solid-js";

import { TracerAPI, type TracerSnapshot } from "../lib/tracer";
import { W100API, type W100Status, type W100RunnerTimes, stationTimesFor } from "../lib/w100";
import { mapStations, type MappedStation } from "../lib/stations";
import { diffStation, type StationRow } from "../lib/diff";
import { formatRaceTime, formatElapsed, parseRaceStart, weekday } from "../lib/time";
import { formatBib } from "../lib/bib";
import { copyText } from "../lib/clipboard";
import {
  loadChecks,
  loadRememberedStation,
  saveChecks,
  saveRememberedStation,
  type StoredCheck,
} from "../lib/station-memory";

const tracer = new TracerAPI();
const w100 = new W100API();

type Tab = "enter" | "missingIn" | "misaligned";

/** Result of pressing Check on one "missing in time" row. */
type Check = { state: "checking" } | ({ state: "done" } & StoredCheck);

const NeedsEntry: Component = () => {
  const [snapshot, setSnapshot] = createSignal<TracerSnapshot | null>(null);
  const [mapped, setMapped] = createSignal<MappedStation[]>([]);
  const [mappingWarnings, setMappingWarnings] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal<W100Status | null>(null);
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [w100Rows, setW100Rows] = createSignal<W100RunnerTimes[] | null>(null);
  const [w100Problem, setW100Problem] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [fatal, setFatal] = createSignal<string | null>(null);
  const [updatedAt, setUpdatedAt] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<Tab>("enter");

  // Dismissals are session-only on purpose: volunteers work one station from
  // several phones, and a reload has to put all of them back on what Tracer
  // and W100 actually say. Check results are the exception -- they are W100's
  // answers, not this device's opinion -- and are restored per station below.
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());
  const [lastUndone, setLastUndone] = createSignal<string | null>(null);
  const [showDone, setShowDone] = createSignal(false);
  const [checks, setChecks] = createSignal<Record<string, Check>>({});

  const station = createMemo(() => mapped().find((s) => s.w100Id === selectedId()) ?? null);
  const raceStartMs = createMemo(() => parseRaceStart(status()?.RaceStartTime));

  // The <option> elements are rebuilt every time `mapped` changes, and a fresh
  // option list leaves the <select> showing its first entry (START) no matter
  // what `selectedId` says -- the value binding is a render effect that has
  // already run by then. Re-assert the selection after the options exist.
  let stationSelect: HTMLSelectElement | undefined;
  createEffect(() => {
    const id = selectedId();
    const options = mapped();
    if (!stationSelect || id === null) return;
    if (options.some((s) => s.w100Id === id)) stationSelect.value = String(id);
  });

  const result = createMemo(() => {
    const snap = snapshot();
    const st = station();
    if (!snap || !st) return null;
    return diffStation({
      entries: snap.entries,
      participants: snap.participants,
      station: { id: st.tracerId },
      w100Rows: w100Rows(),
      raceStartMs: raceStartMs(),
    });
  });

  const toEnter = createMemo(() => (result()?.toEnter ?? []).filter((m) => !dismissed().has(m.key)));
  const hidden = createMemo(() => (result()?.toEnter ?? []).filter((m) => dismissed().has(m.key)));
  const missingIn = createMemo(() => result()?.missingIn ?? []);
  const misaligned = createMemo(() => result()?.misaligned ?? []);

  /** Fetches W100 times for one station. Never throws -- failure means degraded. */
  async function loadW100Times(st: MappedStation) {
    if (!st.queryable) {
      setW100Rows(null);
      setW100Problem(`W100 does not record times for ${st.tracerName}.`);
      return;
    }
    try {
      const rows = await w100.getStationTimes(st.w100Id);
      batch(() => {
        setW100Rows(rows);
        setW100Problem(null);
      });
    } catch (err) {
      batch(() => {
        setW100Rows(null);
        setW100Problem(err instanceof Error ? err.message : String(err));
      });
    }
  }

  /** Drops this device's own judgements, so the lists come back from the APIs. */
  function resetLocalState() {
    batch(() => {
      setDismissed(new Set<string>());
      setLastUndone(null);
      setShowDone(false);
    });
  }

  /** Replays the Check answers already collected for a station. */
  function restoreChecks(w100StationId: number) {
    const stored = loadChecks(w100StationId);
    setChecks(
      Object.fromEntries(
        Object.entries(stored).map(([key, v]) => [key, { state: "done", ...v } as Check]),
      ),
    );
  }

  async function loadAll() {
    setLoading(true);
    resetLocalState();
    try {
      const [snap, w100Stations, w100Status] = await Promise.all([
        tracer.getSnapshot(),
        w100.getStations().catch(() => null),
        w100.getStatus().catch(() => null),
      ]);

      const { stations, warnings } = mapStations(snap.stations, w100Stations);

      // Keep the current station if it still exists, else fall back to the
      // remembered one, else the first station W100 can actually answer for.
      const desired =
        selectedId() ?? loadRememberedStation() ?? stations.find((s) => s.queryable)?.w100Id ?? null;
      const resolved = stations.find((s) => s.w100Id === desired)?.w100Id ?? null;

      batch(() => {
        setSnapshot(snap);
        setMapped(stations);
        setMappingWarnings(warnings);
        setStatus(w100Status);
        setSelectedId(resolved);
        setFatal(null);
      });

      if (resolved !== null) {
        // Persist the resolved station too, not just dropdown picks, so a
        // reload returns to the station the volunteer was actually looking at.
        saveRememberedStation(resolved);
        restoreChecks(resolved);
        const st = stations.find((s) => s.w100Id === resolved);
        if (st) await loadW100Times(st);
      }
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      // Tracer is the one hard dependency: without it there is nothing to show.
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  onMount(() => void loadAll());

  async function onSelect(id: number) {
    const st = mapped().find((s) => s.w100Id === id);
    if (!st) return;
    resetLocalState();
    batch(() => {
      setSelectedId(id);
      setLoading(true);
    });
    saveRememberedStation(id);
    restoreChecks(id);
    await loadW100Times(st);
    batch(() => {
      setUpdatedAt(new Date().toISOString());
      setLoading(false);
    });
  }

  function markDone(key: string) {
    const next = new Set(dismissed());
    next.add(key);
    batch(() => {
      setDismissed(next);
      setLastUndone(key);
    });
  }

  function undo(key: string) {
    const next = new Set(dismissed());
    next.delete(key);
    batch(() => {
      setDismissed(next);
      if (lastUndone() === key) setLastUndone(null);
    });
  }

  /**
   * Asks W100 about one runner, because /aid-station/{id}/times will not tell
   * us: it hides a runner completely while their in-time is -1, out-time and
   * all. One bib per press, never a sweep of the list.
   */
  async function check(item: StationRow) {
    const id = selectedId();
    if (id === null) return;
    setChecks({ ...checks(), [item.key]: { state: "checking" } });

    /** A verdict from W100 is worth keeping; a failed request is not. */
    const settle = (tone: "good" | "warn", message: string, keep = true) => {
      const next = { ...checks(), [item.key]: { state: "done" as const, tone, message, at: new Date().toISOString() } };
      setChecks(next);
      if (!keep) return;
      const stored: Record<string, StoredCheck> = {};
      for (const [key, value] of Object.entries(next)) {
        if (value.state === "done") stored[key] = { tone: value.tone, message: value.message, at: value.at };
      }
      saveChecks(id, stored);
    };

    try {
      const times = stationTimesFor(await w100.getRunnerTimes(item.bib), id);
      const w100Out = times?.out ?? null;
      const w100In = times?.in ?? null;

      if (w100Out === null) {
        settle("warn", w100In === null ? "Not entered yet" : "In time is in — press Refresh");
        return;
      }
      const shown = formatElapsed(w100Out, raceStartMs());
      if (item.tracerElapsed !== null && w100Out !== item.tracerElapsed) {
        settle("warn", `W100 has ${shown ?? "a different time"}, Tracer has ${formatRaceTime(item.iso)}`);
        return;
      }
      settle("good", shown ? `Already entered (${shown})` : "Already entered");
    } catch (err) {
      settle("warn", err instanceof Error ? err.message : String(err), false);
    }
  }

  // The live server reports "Production", not "Race" -- warning on anything
  // that is not literally "race" put a "this comparison is not meaningful"
  // banner above the queue for the whole event.
  const LIVE_MODES = new Set(["race", "production"]);
  const testMode = createMemo(() => {
    const s = status();
    return s ? !LIVE_MODES.has(s.OperatingMode.toLowerCase().trim()) : false;
  });

  return (
    <div class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mx-auto max-w-2xl px-4 pb-24 pt-5">
        <header class="mb-4">
          <h1 class="text-xl font-bold tracking-tight">Tracer vs W100</h1>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
            One look at Tracer's times for your aid station, sorted by what needs doing.
          </p>
        </header>

        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Your aid station
          </span>
          <select
            ref={stationSelect}
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base font-medium shadow-sm dark:border-slate-700 dark:bg-slate-900"
            value={selectedId() ?? ""}
            onChange={(e) => void onSelect(Number(e.currentTarget.value))}
          >
            <For each={mapped()}>
              {(s) => (
                <option value={s.w100Id}>{stationLabel(s)}</option>
              )}
            </For>
          </select>
        </label>

        <div class="mt-3 flex items-center gap-3">
          <button
            type="button"
            class="rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white shadow-sm active:scale-[0.98] disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            disabled={loading()}
            onClick={() => void loadAll()}
          >
            {loading() ? "Refreshing…" : "Refresh"}
          </button>
          <Show when={updatedAt()}>
            <span class="text-sm text-slate-500 dark:text-slate-400">
              Updated {formatRaceTime(updatedAt())}
            </span>
          </Show>
        </div>

        <Show when={fatal()}>
          {(msg) => (
            <Banner tone="error" title="Could not reach Tracer">
              {msg()}
            </Banner>
          )}
        </Show>

        <Show when={w100Problem()}>
          {(msg) => (
            <Banner tone="warn" title="Showing every Tracer time (unverified)">
              W100 could not be checked, so this list is not filtered against it and may include
              times already entered. {msg()}
            </Banner>
          )}
        </Show>

        <Show when={testMode() && status()}>
          {(s) => (
            <Banner tone="warn" title={`W100 is in "${s().OperatingMode}" mode`}>
              It is serving {s().EventName} starting {s().RaceStartTime}. Until it is switched to
              the live race, this comparison will not be meaningful.
            </Banner>
          )}
        </Show>

        <Show when={mappingWarnings().length > 0}>
          <Banner tone="warn" title="Aid station lists do not line up">
            <ul class="list-disc pl-5">
              <For each={mappingWarnings()}>{(w) => <li>{w}</li>}</For>
            </ul>
          </Banner>
        </Show>

        <div class="mt-6 grid grid-cols-3 gap-1 rounded-xl bg-slate-200 p-1 dark:bg-slate-800">
          <TabButton
            active={tab() === "enter"}
            count={toEnter().length}
            label="To enter"
            onSelect={() => setTab("enter")}
          />
          <TabButton
            active={tab() === "missingIn"}
            count={missingIn().length}
            label="Missing in"
            onSelect={() => setTab("missingIn")}
          />
          <TabButton
            active={tab() === "misaligned"}
            count={misaligned().length}
            label="Misaligned"
            onSelect={() => setTab("misaligned")}
          />
        </div>

        <Show when={tab() === "enter"}>
          <p class="mt-4 text-sm text-slate-600 dark:text-slate-400">
            Recorded in Tracer, not yet in W100, and ready to type.
          </p>
          <List
            items={toEnter()}
            loading={loading()}
            empty="Nothing to enter right now."
            render={(item) => <Row item={item} trailing={<DoneButton onClick={() => markDone(item.key)} />} />}
          />

          <Show when={hidden().length > 0}>
            <section class="mt-8">
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left text-sm font-medium text-slate-600 dark:text-slate-400"
                onClick={() => setShowDone(!showDone())}
              >
                <span>Marked done ({hidden().length})</span>
                <span aria-hidden="true">{showDone() ? "▲" : "▼"}</span>
              </button>
              <Show when={lastUndone()}>
                {(key) => (
                  <button
                    type="button"
                    class="mb-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-700"
                    onClick={() => undo(key())}
                  >
                    Undo last ({undoLabel(key())})
                  </button>
                )}
              </Show>
              <Show when={showDone()}>
                <ul class="space-y-2 opacity-70">
                  <For each={hidden()}>
                    {(item) => (
                      <Row item={item} trailing={<DoneButton done onClick={() => undo(item.key)} />} />
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </Show>
        </Show>

        <Show when={tab() === "missingIn"}>
          <p class="mt-4 text-sm text-slate-600 dark:text-slate-400">
            Tracer has a departure, W100 has no arrival for the runner. W100 will not show us their
            out time until the in time lands, so Check asks about the one runner.
          </p>
          <List
            items={missingIn()}
            loading={loading()}
            empty="Every runner here has an in time in W100."
            render={(item) => (
              <Row
                item={item}
                note={checks()[item.key]}
                trailing={
                  <button
                    type="button"
                    class="shrink-0 rounded-lg border border-slate-300 px-3 py-3 text-sm font-semibold active:scale-[0.98] disabled:opacity-50 dark:border-slate-700"
                    disabled={checks()[item.key]?.state === "checking"}
                    onClick={() => void check(item)}
                  >
                    {checkLabel(checks()[item.key])}
                  </button>
                }
              />
            )}
          />
        </Show>

        <Show when={tab() === "misaligned"}>
          <p class="mt-4 text-sm text-slate-600 dark:text-slate-400">
            Both sides have the time and they disagree. One of them is a typo.
          </p>
          <Show
            when={raceStartMs() !== null}
            fallback={
              <Banner tone="warn" title="Cannot compare times">
                W100's race start time is unavailable, so Tracer's clock times cannot be lined up
                against W100's elapsed times. Press Refresh.
              </Banner>
            }
          >
            <List
              items={misaligned()}
              loading={loading()}
              empty="Every time that exists on both sides matches."
              render={(item) => (
                <Row item={item} w100Time={formatElapsed(item.w100Elapsed, raceStartMs())} />
              )}
            />
          </Show>
        </Show>

        <footer class="mt-10 text-xs leading-relaxed text-slate-400 dark:text-slate-600">
          Times shown are Tracer's, in Mountain time. Nothing is remembered between page loads
          except your aid station — reload to pull both lists fresh and re-align with whoever else
          is entering times.
        </footer>
      </div>
    </div>
  );
};

/** Tracer shouts its station names where W100 title-cases them, so only show
 *  W100's spelling when it is genuinely a different name. */
function stationLabel(s: MappedStation): string {
  const same =
    s.w100Name && s.w100Name.toLowerCase().trim() === s.tracerName.toLowerCase().trim();
  return s.w100Name && !same ? `${s.tracerName} — ${s.w100Name}` : s.tracerName;
}

/** A result already on screen may be hours old, so offer to take it again. */
function checkLabel(check: Check | undefined): string {
  if (check?.state === "checking") return "…";
  return check?.state === "done" ? "Recheck" : "Check";
}

/** "153-out" is a storage key, not something to show a volunteer at 2am. */
function undoLabel(key: string): string {
  const [bib, kind] = key.split("-");
  return `${formatBib(Number(bib))} ${kind}`;
}

const TabButton: Component<{
  active: boolean;
  count: number;
  label: string;
  onSelect: () => void;
}> = (props) => (
  <button
    type="button"
    aria-pressed={props.active}
    class={`rounded-lg px-2 py-2 text-center text-sm font-semibold ${
      props.active
        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
        : "text-slate-600 dark:text-slate-400"
    }`}
    onClick={() => props.onSelect()}
  >
    <span class="block truncate">{props.label}</span>
    <span class="block text-lg font-bold tabular-nums leading-tight">{props.count}</span>
  </button>
);

const List: Component<{
  items: StationRow[];
  loading: boolean;
  empty: string;
  render: (item: StationRow) => JSX.Element;
}> = (props) => (
  <Show
    when={props.items.length > 0}
    fallback={
      <p class="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <Show when={!props.loading} fallback="Loading…">
          {props.empty}
        </Show>
      </p>
    }
  >
    <ul class="mt-3 space-y-2">
      <For each={props.items}>{(item) => props.render(item)}</For>
    </ul>
  </Show>
);

const DoneButton: Component<{ done?: boolean; onClick: () => void }> = (props) => (
  // "Done", not "Mark done": the longer label ate ~45px of a 390px row, which
  // is what pushed the copy button into it.
  <button
    type="button"
    class="shrink-0 rounded-lg border border-slate-300 px-3 py-3 text-sm font-semibold active:scale-[0.98] dark:border-slate-700"
    onClick={() => props.onClick()}
  >
    {props.done ? "Undo" : "Done"}
  </button>
);

/**
 * Copy-button state that reverts on a timer, so a button never sits there
 * claiming a copy that happened a quarter of an hour ago. One per target: the
 * bib and the time are copied independently and must report independently.
 */
function createCopier() {
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle");
  let revert: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string) {
    if (!text) return;
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    clearTimeout(revert);
    revert = setTimeout(() => setState("idle"), 1800);
  }

  onCleanup(() => clearTimeout(revert));
  return { state, copy };
}

const CopyStatus: Component<{ state: "idle" | "copied" | "failed" }> = (props) => (
  <span class="sr-only" aria-live="polite">
    {props.state === "copied" ? "Copied" : props.state === "failed" ? "Copy failed" : ""}
  </span>
);

const Row: Component<{
  item: StationRow;
  /** W100's value for the same time, shown only where the two disagree. */
  w100Time?: string | null;
  /** Outcome of a per-runner Check, shown under the runner's name. */
  note?: Check;
  trailing?: JSX.Element;
}> = (props) => {
  const time = createMemo(() => formatRaceTime(props.item.iso) ?? "");
  const bibCopy = createCopier();
  const timeCopy = createCopier();

  return (
    <li class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* The whole bib is the button rather than an icon beside it: the row
          already fights for width at 390px, and a 3xl numeral is a far better
          tap target than anything that would fit next to it. */}
      <button
        type="button"
        class="-my-1 w-16 shrink-0 rounded-lg py-1 text-left active:bg-slate-100 dark:active:bg-slate-800"
        title={`Copy bib ${props.item.bib}`}
        aria-label={`Copy bib ${props.item.bib}`}
        onClick={() => void bibCopy.copy(String(props.item.bib))}
      >
        <span
          class={`block text-3xl font-bold tabular-nums leading-none ${
            bibCopy.state() === "copied" ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {formatBib(props.item.bib)}
        </span>
        {/* Without this a bare numeral gives no hint that it is tappable. */}
        <CopyIcon state={bibCopy.state()} class="mt-1 size-3.5" />
        <CopyStatus state={bibCopy.state()} />
      </button>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span
            class={`w-8 shrink-0 rounded py-0.5 text-center text-xs font-bold uppercase tracking-wide ${
              props.item.kind === "in"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
            }`}
          >
            {props.item.kind}
          </span>
          {/* A fixed-width column, not a right-aligned one: left-aligned with
              tabular figures, HH:MM lines up with the HH:MM of a neighbouring
              HH:MM:SS and the seconds simply trail off the end. The width is
              what keeps the copy button in a straight line down the list. */}
          <span class="min-w-[7.5ch] text-xl font-semibold tabular-nums">{time()}</span>
          <button
            type="button"
            class="-my-1 shrink-0 rounded-lg p-1.5 text-slate-500 active:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:active:bg-slate-800"
            disabled={!time()}
            title={`Copy ${time()}`}
            aria-label={`Copy ${time()}`}
            onClick={() => void timeCopy.copy(time())}
          >
            <CopyIcon state={timeCopy.state()} />
            <CopyStatus state={timeCopy.state()} />
          </button>
        </div>
        <Show when={props.w100Time}>
          {(w) => (
            <div class="text-sm font-medium text-red-700 dark:text-red-400">
              W100 has <span class="tabular-nums">{w()}</span>
            </div>
          )}
        </Show>
        <div class="truncate text-sm text-slate-500 dark:text-slate-400">
          <Show when={weekday(props.item.iso)}>
            {(day) => (
              <span class="font-medium uppercase text-slate-400 dark:text-slate-500">
                {day()}
                {" · "}
              </span>
            )}
          </Show>
          {props.item.runnerName ?? "Unknown runner"}
        </div>
        <Show when={props.note?.state === "done" ? props.note : null}>
          {(note) => (
            <div
              class={`text-sm font-medium ${
                note().tone === "good"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
              aria-live="polite"
            >
              {note().message}
              {/* Stamped because a restored answer can be hours stale, and the
                  row gives no other clue that it was not just fetched. */}
              <Show when={formatRaceTime(note().at)}>
                {(at) => (
                  <span class="font-normal text-slate-500 dark:text-slate-400">
                    {" · checked "}
                    <span class="tabular-nums">{at()}</span>
                  </span>
                )}
              </Show>
            </div>
          )}
        </Show>
      </div>
      {props.trailing}
    </li>
  );
};

const CopyIcon: Component<{ state: "idle" | "copied" | "failed"; class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={`${props.class ?? "size-5"} ${
      props.state === "copied"
        ? "text-emerald-600 dark:text-emerald-400"
        : props.state === "failed"
          ? "text-red-600 dark:text-red-400"
          : "text-slate-500 dark:text-slate-400"
    }`}
    aria-hidden="true"
  >
    <Show
      when={props.state === "copied"}
      fallback={
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h8" />
        </>
      }
    >
      <path d="M20 6 9 17l-5-5" />
    </Show>
  </svg>
);

const Banner: Component<{
  tone: "warn" | "error";
  title: string;
  children: unknown;
}> = (props) => (
  <div
    class={`mt-4 rounded-lg border p-3 text-sm ${
      props.tone === "error"
        ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    }`}
  >
    <p class="font-semibold">{props.title}</p>
    <div class="mt-1">{props.children as never}</div>
  </div>
);

export default NeedsEntry;
