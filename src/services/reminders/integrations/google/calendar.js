import { addDays } from "date-fns";
import { extractEmailFromText, googleGet, normalizeEmail } from "./shared.js";

function extractInviteeEmail(config, event) {
  const organizerEmail = normalizeEmail(event.organizer?.email);
  const ignoredEmails = new Set([
    organizerEmail,
    normalizeEmail(config.googleCalendarClientEmail),
    normalizeEmail(config.googleCalendarId),
  ]);

  for (const attendee of event.attendees || []) {
    const email = normalizeEmail(attendee.email);
    if (email && !ignoredEmails.has(email)) {
      return email;
    }
  }

  return extractEmailFromText(event.description) || extractEmailFromText(event.summary) || null;
}

function getEventStart(event) {
  if (event.start?.dateTime) return event.start.dateTime;
  if (event.start?.date) return `${event.start.date}T00:00:00`;
  return null;
}

function getEventStatus(event) {
  const status = String(event.status || "").toLowerCase();
  if (status === "confirmed") return "confirmed";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
}

export async function fetchCalendarEvents(config) {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = addDays(now, config.googleCalendarLookaheadDays).toISOString();

  const data = await googleGet(
    config,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      config.googleCalendarId
    )}/events`,
    {
      singleEvents: true,
      orderBy: "startTime",
      timeMin,
      timeMax,
      maxResults: 250,
      fields:
        "items(id,status,summary,description,start,end,attendees(email),organizer(email)),nextPageToken",
    }
  );

  return (data.items || [])
    .map((event) => ({
      eventId: event.id,
      startsAt: getEventStart(event),
      status: getEventStatus(event),
      inviteeEmail: extractInviteeEmail(config, event),
      summary: String(event.summary || "").trim(),
    }))
    .filter((event) => event.eventId && event.startsAt && event.status !== "cancelled");
}
