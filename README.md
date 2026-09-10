# Tracer → W100 diff page

Shows Wasatch 100 aid-station volunteers which runner times exist in
[Tracer](https://trackmyracer.live) but have not yet been entered into the
official W100 system.

Pick your aid station, get a list of bib numbers with the Tracer time to type
in, press **Refresh** to re-check both systems, **Mark done** to clear a row.
Anything still missing in W100 comes back on the next refresh.

**Live:** https://d9320kgud8kd8.cloudfront.net

## How it works

| | source | cost per refresh |
|---|---|---|
| Tracer | `trackmyracer.live/api/v1/events/w100-26` → `stations`, `participants`, `entries` | 3 requests, fetched directly (Tracer sends `access-control-allow-origin: *`) |
| W100 | `GET /w100/aid-station/{id}/times` | **1 request** — one call returns every time for the station |

A volunteer only ever looks at their own aid station, so the W100 side costs a
single request. There is no per-bib fanout.

In- and out-times are tracked as separate items, because a runner's arrival is
often recorded while their departure is not, and the volunteer needs to know
which of the two to type.

### The proxy

W100 sends no CORS headers on any host, so the browser cannot call it directly.
CloudFront fronts it as a second origin — this app is read-only, so there is
nothing for a Lambda to do that a proxying behavior cannot:

```
/w100/aid-station/4/times
  → CloudFront function strips the /w100 prefix
  → origin w100as.web.app with origin_path=/api
  → https://w100as.web.app/api/aid-station/4/times
```

That behavior deliberately has **no origin request policy**: Firebase Hosting
routes on the `Host` header, so CloudFront must send the origin's own host.
Attaching `AllViewer` or `AllViewerExceptHostHeader` breaks it.

A 15s cache TTL, keyed per URL so per station, collapses a crowd of volunteers
refreshing at once into a single hit on the W100 race server.

### Degraded mode

W100's race server is a dynamic-DNS host that is not always up; the Firebase
function in front of it then answers `502 Could not reach race server`. When
W100 cannot be read the page keeps working as a plain checklist over Tracer
times, with a banner saying the list is unverified. Tracer is the only hard
dependency.

### Privacy

W100's `/api/runner` returns runner email addresses and phone numbers. It is
**not proxied and not used** — names come from Tracer's `participants`, which
carries no contact details. A test asserts that endpoint is never requested.

The `apikey` file, the `X-API-Key` header and `w100-rest.ddns.net:60080` are
not used anywhere; every W100 endpoint read here is already public.

## Development

```sh
pnpm install
pnpm dev        # http://localhost:3000, /w100 proxied to w100as.web.app/api
pnpm test       # cross-mock suites
pnpm build
```

### Tests

The two systems have no overlapping real data until race day, so each API is
tested live while the other is mocked:

- **Config A** (`src/lib/config-a.test.ts`) — real W100, synthesized Tracer
  entries derived from the live response. If W100 is down, the live-transport
  assertions skip *loudly* and the diff assertions fall back to a recorded
  snapshot, so an outage never silently reduces coverage.
- **Config B** (`src/lib/config-b.test.ts`) — real Tracer, mocked W100 through
  every branch: empty, 404, all-`-1`, PascalCase error, hard failure.

### Deploy

```sh
cd apps/infrastructure && terraform apply
cd apps/webapp && pnpm build
aws s3 sync dist/ s3://tw100d-webapp-nio3ix/ --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://tw100d-webapp-nio3ix/index.html \
  --cache-control "no-cache,must-revalidate"
aws cloudfront create-invalidation --distribution-id E2U9MROTTQ8OMI --paths "/*"
```

Uses AWS profile `ut-threat` (account 056598115456) in `us-west-2`.

## Field notes

- W100 uses `-1`, not null, for "not entered".
- An aid station with nothing recorded answers **404**, which means empty, not
  an error.
- W100 station 1 (START) rejects time queries with 400; it is marked
  non-queryable.
- Tracer entries sometimes **omit** `timeOut` entirely rather than nulling it.
- Tracer station `stationNumber + 1` == W100 `AidStationID`, and Tracer encodes
  the same id in `stationNumberDisplayed` (`(P)(16)`). Both are checked at
  startup; a mismatch raises a banner instead of silently mis-mapping.
- Tracer abbreviates where W100 spells out (`BIG MTN` / `Big Mountain Pass`),
  and their distances disagree for Big Water (56.4 vs 52.9 mi). Neither is a
  mapping error.

## Not done

Writing back to W100. `PUT /aid-station/{id}/runner/{bib}/times` is open
through the same proxy and would let a volunteer fix an entry with one tap, but
writing to a live race system needs explicit sign-off from the W100 developers
first.
