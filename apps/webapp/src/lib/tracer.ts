// Client for the Tracer API (trackmyracer.live).
//
// Ported from tracer-time-sync/apps/api/src/sdks/tracer.ts, with the types
// loosened to match what the live w100-26 event actually returns:
//   - `timeOut`/`timeOutModified` are absent entirely on some entries, not null
//   - `dnfReason`/`dnfStation` are absent on this event's participants
//   - participants carry `sex`/`age`, which the original SDK did not model
//
// Tracer sends `access-control-allow-origin: *`, so this is called directly
// from the browser with no proxy.

export interface Entry {
  _id: string;
  eventId: string;
  participantId: string;
  stationId: string;
  timeIn: string | null;
  timeOut?: string | null;
  timeInModified?: string | null;
  timeOutModified?: string | null;
  createdAt: string;
  updatedAt: string;
  id: string;
}

export interface Participant {
  _id: string;
  bibNumber: number;
  eventId: string;
  firstName?: string;
  lastName?: string;
  sex?: string;
  age?: string;
  raceId?: string;
  dnfReason?: string | null;
  dnfStation?: number | null;
  id: string;
}

export interface Station {
  _id: string;
  eventId: string;
  name: string;
  distance: number;
  stationNumber: number;
  stationNumberDisplayed: string;
  createdAt: string;
  updatedAt: string;
  id: string;
}

export interface TracerEvent {
  _id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  startStation?: number;
  finishStation?: number;
  id: string;
}

export interface TracerSnapshot {
  event: TracerEvent;
  stations: Station[];
  participants: Participant[];
  entries: Entry[];
}

export type FetchLike = typeof fetch;

export const TRACER_BASE_URL = "https://trackmyracer.live";
export const TRACER_EVENT_SLUG = "w100-26";

export class TracerAPI {
  private readonly fetchImpl: FetchLike;

  constructor(
    fetchImpl: FetchLike = fetch,
    private readonly baseUrl: string = TRACER_BASE_URL,
  ) {
    // Wrapped rather than stored directly: calling `this.fetchImpl(...)` would
    // invoke the browser's native fetch with `this` set to this instance, which
    // throws "Illegal invocation". Node's fetch does not enforce that, so this
    // only ever fails in a real browser.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new Error(`Tracer ${res.status} ${res.statusText} - ${url}`);
    }
    return (await res.json()) as T;
  }

  // The slug is resolved to a Mongo _id at runtime rather than hardcoded, so a
  // re-created event does not silently break the app.
  getEvent(slug: string = TRACER_EVENT_SLUG) {
    return this.get<TracerEvent>(`/events/${slug}`);
  }

  getStations(eventId: string) {
    return this.get<Station[]>(`/events/${eventId}/stations`);
  }

  getParticipants(eventId: string) {
    return this.get<Participant[]>(`/events/${eventId}/participants`);
  }

  getEntries(eventId: string) {
    return this.get<Entry[]>(`/events/${eventId}/entries`);
  }

  async getSnapshot(slug: string = TRACER_EVENT_SLUG): Promise<TracerSnapshot> {
    const event = await this.getEvent(slug);
    const [stations, participants, entries] = await Promise.all([
      this.getStations(event._id),
      this.getParticipants(event._id),
      this.getEntries(event._id),
    ]);
    return { event, stations, participants, entries };
  }
}
