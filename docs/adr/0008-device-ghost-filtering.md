# ADR 0008: Device List Ghost Filtering via API Param

## Status
Accepted

## Context
Pushbullet `/v2/devices` returns **all devices ever** (deleted ghosts: active=false, missing nickname/model/manufacturer/type → \"Unknown Device\"). Popup \"Send to\" cluttered with 17 ghosts vs web UI (pushbullet.com/devices) shows clean active list.

Constraints:
- API returns ghosts by default.
- Ghosts targetable but useless (no name).
- Cache/session must preserve real devices.

Forces:
- UX: Clean dropdown matching web.
- Reliability: Don't break sends to offline mobiles.

## Decision
Use `/v2/devices?active=true` param → API returns **only active devices** (Chrome extensions + mobiles, ghosts excluded server-side).

Implementation:
- src/app/api/client.ts:fetchDevices → `${DEVICES_URL}?active=true`.
- Fallback naming: `nickname || manufacturer model/type + (offline)`.
- Logging: total/active/inactive/ghost counts.

Removed client filters (unneeded).

## Consequences

### Pros
- Matches web UI exactly (6 devices).
- Ghosts gone server-side (no client perf hit).
- Offline mobiles preserved/targetable.

### Cons
- Misses truly inactive named devices (rare, UX win).

### Neutral
- Slightly fewer API results.
- Cache reflects API (clean).