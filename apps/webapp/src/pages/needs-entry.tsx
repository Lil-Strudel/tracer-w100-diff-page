import {
  type Component,
  createSignal,
  createMemo,
  onMount,
  For,
  Show,
  batch,
} from "solid-js";

import { TracerAPI, type TracerSnapshot } from "../lib/tracer";
import { W100API, type W100Status, type W100RunnerTimes } from "../lib/w100";
import { mapStations, type MappedStation } from "../lib/stations";
import { diffStation, type MissingTime } from "../lib/diff";
import { formatRaceTime, weekday } from "../lib/time";
import {
  loadDismissed,
  saveDismissed,
  clearDismissed,
  loadRememberedStation,
  saveRememberedStation,
} from "../lib/dismissed";

const tracer = new TracerAPI();
const w100 = new W100API();

const NeedsEntry: Component = () => {
  const [snapshot, setSnapshot] = createSignal<TracerSnapshot | null>(null);
  const [mapped, setMapped] = createSignal<MappedStation[]>([]);
  const [mappingWarnings, setMappingWarnings] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal<W100Status | null>(null);
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [w100Rows, setW100Rows] = createSignal<W100RunnerTimes[] | null>(null);
  const [w100Problem, setW100Problem] = createSignal<string | null>(null);
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());
  const [lastUndone, setLastUndone] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [fatal, setFatal] = createSignal<string | null>(null);
  const [updatedAt, setUpdatedAt] = createSignal<string | null>(null);
  const [showDone, setShowDone] = createSignal(false);

  const station = createMemo(() => mapped().find((s) => s.w100Id === selectedId()) ?? null);

  const result = createMemo(() => {
    const snap = snapshot();
    const st = station();
    if (!snap || !st) return null;
    return diffStation({
      entries: snap.entries,
      participants: snap.participants,
      station: { id: st.tracerId },
      w100Rows: w100Rows(),
    });
  });

  const visible = createMemo(() => (result()?.missing ?? []).filter((m) => !dismissed().has(m.key)));
  const hidden = createMemo(() => (result()?.missing ?? []).filter((m) => dismissed().has(m.key)));

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

  async function loadAll(opts: { clearDismissals: boolean }) {
    setLoading(true);
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
        if (opts.clearDismissals) {
          clearDismissed(resolved);
          setDismissed(new Set<string>());
        } else {
          setDismissed(loadDismissed(resolved));
        }
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

  onMount(() => void loadAll({ clearDismissals: false }));

  async function onSelect(id: number) {
    const st = mapped().find((s) => s.w100Id === id);
    if (!st) return;
    batch(() => {
      setSelectedId(id);
      setDismissed(loadDismissed(id));
      setLastUndone(null);
      setLoading(true);
    });
    saveRememberedStation(id);
    await loadW100Times(st);
    batch(() => {
      setUpdatedAt(new Date().toISOString());
      setLoading(false);
    });
  }

  function markDone(key: string) {
    const next = new Set(dismissed());
    next.add(key);
    setDismissed(next);
    setLastUndone(key);
    const id = selectedId();
    if (id !== null) saveDismissed(id, next);
  }

  function undo(key: string) {
    const next = new Set(dismissed());
    next.delete(key);
    setDismissed(next);
    if (lastUndone() === key) setLastUndone(null);
    const id = selectedId();
    if (id !== null) saveDismissed(id, next);
  }

  const testMode = createMemo(() => {
    const s = status();
    return s ? s.OperatingMode.toLowerCase() !== "race" : false;
  });

  return (
    <div class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mx-auto max-w-2xl px-4 pb-24 pt-5">
        <header class="mb-4">
          <h1 class="text-xl font-bold tracking-tight">Times to enter into W100</h1>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Recorded in Tracer, not yet in W100.
          </p>
        </header>

        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Your aid station
          </span>
          <select
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
            onClick={() => void loadAll({ clearDismissals: true })}
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

        <h2 class="mt-6 flex items-baseline justify-between">
          <span class="text-lg font-semibold">Runners that need to be entered</span>
          <span class="text-2xl font-bold tabular-nums">{visible().length}</span>
        </h2>

        <Show
          when={visible().length > 0}
          fallback={
            <p class="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <Show when={!loading()} fallback="Loading…">
                Nothing to enter right now.
              </Show>
            </p>
          }
        >
          <ul class="mt-3 space-y-2">
            <For each={visible()}>{(item) => <Row item={item} onDone={() => markDone(item.key)} />}</For>
          </ul>
        </Show>

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
                  Undo last ({key()})
                </button>
              )}
            </Show>
            <Show when={showDone()}>
              <ul class="space-y-2 opacity-70">
                <For each={hidden()}>
                  {(item) => <Row item={item} done onDone={() => undo(item.key)} />}
                </For>
              </ul>
            </Show>
          </section>
        </Show>

        <footer class="mt-10 text-xs leading-relaxed text-slate-400 dark:text-slate-600">
          Times shown are Tracer's, in Mountain time. Marking done hides a row until you press
          Refresh; if the time is still missing in W100 it comes back.
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

const Row: Component<{ item: MissingTime; done?: boolean; onDone: () => void }> = (props) => (
  <li class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div class="w-16 shrink-0 text-3xl font-bold tabular-nums leading-none">{props.item.bib}</div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span
          class={`rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
            props.item.kind === "in"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
              : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
          }`}
        >
          {props.item.kind}
        </span>
        <span class="text-xl font-semibold tabular-nums">{formatRaceTime(props.item.iso)}</span>
        <span class="text-xs font-medium uppercase text-slate-400 dark:text-slate-500">
          {weekday(props.item.iso)}
        </span>
      </div>
      <div class="truncate text-sm text-slate-500 dark:text-slate-400">
        {props.item.runnerName ?? "Unknown runner"}
      </div>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-lg border border-slate-300 px-3 py-3 text-sm font-semibold active:scale-[0.98] dark:border-slate-700"
      onClick={() => props.onDone()}
    >
      {props.done ? "Undo" : "Mark done"}
    </button>
  </li>
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
