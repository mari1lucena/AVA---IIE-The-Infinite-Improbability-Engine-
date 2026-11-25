/**
 * Thin wrapper over the Google Calendar REST API (v3). Just the calls the
 * agenda sync needs — list (incremental), insert, patch, delete, and the
 * watch/stop push-channel pair. All take a short-lived access token (minted
 * from the sealed refresh token in oauth.ts).
 */

const BASE = "https://www.googleapis.com/calendar/v3";

/** Raised when an incremental sync token has expired — caller must full-resync. */
export class SyncTokenExpiredError extends Error {}

export type GCalDateTime = {
  dateTime?: string; // RFC3339, e.g. 2026-08-24T09:00:00+01:00
  date?: string; // all-day events (we ignore these)
  timeZone?: string;
};

export type GCalEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: GCalDateTime;
  end?: GCalDateTime;
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
};

async function call(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export type ListResult = {
  items: GCalEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
};

/**
 * List events. Pass `syncToken` for an incremental pull (only what changed);
 * omit it (with a time window) for the initial full sync. A 410 from Google
 * means the token lapsed → surfaced as {@link SyncTokenExpiredError}.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  opts: {
    syncToken?: string | null;
    timeMin?: string;
    timeMax?: string;
    pageToken?: string;
  } = {},
): Promise<ListResult> {
  const q = new URLSearchParams({ singleEvents: "true", maxResults: "2500" });
  if (opts.syncToken) q.set("syncToken", opts.syncToken);
  else {
    // Full sync: bound it so we don't drag in years of history.
    if (opts.timeMin) q.set("timeMin", opts.timeMin);
    if (opts.timeMax) q.set("timeMax", opts.timeMax);
    q.set("orderBy", "startTime");
  }
  if (opts.pageToken) q.set("pageToken", opts.pageToken);

  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`,
  );
  if (res.status === 410) throw new SyncTokenExpiredError();
  if (!res.ok) {
    throw new Error(`Calendar list failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    items?: GCalEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
  };
  return {
    items: json.items ?? [],
    nextSyncToken: json.nextSyncToken,
    nextPageToken: json.nextPageToken,
  };
}

/**
 * Create a new secondary calendar in the connected account. Used to provision
 * one calendar per doctor on connect, so each doctor's slots sync to their own
 * calendar under the single clinic Google account.
 */
export async function createCalendar(
  accessToken: string,
  summary: string,
  timeZone = "Europe/Lisbon",
): Promise<{ id: string }> {
  const res = await call(accessToken, `/calendars`, {
    method: "POST",
    body: JSON.stringify({ summary, timeZone }),
  });
  if (!res.ok) {
    throw new Error(`Calendar create failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { id: string };
  return { id: json.id };
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: Partial<GCalEvent>,
): Promise<GCalEvent> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(event) },
  );
  if (!res.ok) {
    throw new Error(`Calendar insert failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as GCalEvent;
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Partial<GCalEvent>,
): Promise<void> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  // A patch onto an event the user already deleted → treat as done, not fatal.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar patch failed (${res.status}): ${await res.text()}`);
  }
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // 404/410 = already gone; 200/204 = deleted. Anything else is a real error.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar delete failed (${res.status}): ${await res.text()}`);
  }
}

// --- push notifications (watch / stop) -------------------------------------

export type WatchChannel = { id: string; resourceId: string; expiration?: string };

/**
 * Subscribe to change notifications for a calendar. Google POSTs `address`
 * whenever the calendar changes; `token` comes back in the header so the
 * webhook can tell which clinic it's for. Channels lapse (~days) and must be
 * renewed. Needs `address` to be a public HTTPS URL Google can reach.
 */
export async function watchEvents(
  accessToken: string,
  calendarId: string,
  channel: { id: string; address: string; token: string; ttlSeconds?: number },
): Promise<WatchChannel> {
  const body: Record<string, unknown> = {
    id: channel.id,
    type: "web_hook",
    address: channel.address,
    token: channel.token,
  };
  if (channel.ttlSeconds) body.params = { ttl: String(channel.ttlSeconds) };

  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!res.ok) {
    throw new Error(`Calendar watch failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { resourceId: string; expiration?: string };
  return { id: channel.id, resourceId: json.resourceId, expiration: json.expiration };
}

/** Tear down a push channel (best effort — used on disconnect). */
export async function stopChannel(
  accessToken: string,
  channel: WatchChannel,
): Promise<void> {
  const res = await fetch(`${BASE}/channels/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: channel.id, resourceId: channel.resourceId }),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Channel stop failed (${res.status}): ${await res.text()}`);
  }
}
