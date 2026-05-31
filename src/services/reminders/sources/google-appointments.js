import { fetchCalendarEvents } from "../integrations/google/calendar.js";
import { fetchPatientsSheet } from "../integrations/google/sheets.js";
import {
  fetchEligibleReminderAppointments,
  upsertAppointments,
} from "../persistence/appointments.js";
import { logReminderDiagnostic } from "../persistence/message-log.js";

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return digits;
}

function buildGoogleAppointmentId(eventId) {
  return `gcal:${eventId}`;
}

function createAppointmentRow(config, event, overrides) {
  return {
    id: buildGoogleAppointmentId(event.eventId),
    source: "google_calendar",
    sourceEventId: event.eventId,
    startsAt: event.startsAt,
    timezone: config.googleCalendarTimezone || config.timezone,
    calendarStatus: event.status,
    rawEvent: event,
    ...overrides,
  };
}

export function buildNormalizedGoogleAppointmentRows(config, events, patientsByEmail) {
  return events.map((event) => {
    if (!event.inviteeEmail) {
      return createAppointmentRow(config, event, {
        patientName: event.summary || null,
        patientEmail: null,
        patientPhone: null,
        eligibilityStatus: "unmatched",
        skipReason: "calendar_event_missing_email",
        errorMessage: "Calendar event has no invitee email to match against the patient sheet.",
      });
    }

    const patient = patientsByEmail.get(event.inviteeEmail);
    if (!patient) {
      return createAppointmentRow(config, event, {
        patientName: event.summary || null,
        patientEmail: event.inviteeEmail,
        patientPhone: null,
        eligibilityStatus: "unmatched",
        skipReason: "patient_email_not_found",
        errorMessage: "Calendar event email was not found in the patient sheet.",
      });
    }

    const patientPhone = normalizePhone(patient.phone);
    if (!patientPhone) {
      return createAppointmentRow(config, event, {
        patientName: patient.fullName || event.summary || event.inviteeEmail,
        patientEmail: event.inviteeEmail,
        patientPhone: patient.phone || null,
        eligibilityStatus: "invalid_contact",
        skipReason: "patient_phone_invalid",
        errorMessage: "Patient match exists, but the phone is missing or invalid.",
      });
    }

    return createAppointmentRow(config, event, {
      patientName: patient.fullName || event.summary || event.inviteeEmail,
      patientEmail: event.inviteeEmail,
      patientPhone,
      eligibilityStatus: "eligible",
      skipReason: null,
      errorMessage: null,
    });
  });
}

async function logIneligibleAppointment(config, appointment) {
  if (appointment.eligibilityStatus === "eligible") {
    return;
  }

  await logReminderDiagnostic(config, {
    appointmentId: appointment.id,
    reminderType: "eligibility",
    patientName: appointment.patientName,
    patientEmail: appointment.patientEmail,
    patientPhone: appointment.patientPhone,
    startsAt: appointment.startsAt,
    status: appointment.eligibilityStatus,
    skipReason: appointment.skipReason,
    errorMessage: appointment.errorMessage,
  });
}

export async function syncGoogleAppointments(config) {
  const [events, patientsByEmail] = await Promise.all([
    fetchCalendarEvents(config),
    fetchPatientsSheet(config),
  ]);

  const appointments = buildNormalizedGoogleAppointmentRows(config, events, patientsByEmail);
  await upsertAppointments(config, appointments);

  for (const appointment of appointments) {
    await logIneligibleAppointment(config, appointment);
  }

  return appointments;
}

export async function listGoogleReminderAppointments(config) {
  await syncGoogleAppointments(config);
  return fetchEligibleReminderAppointments(config);
}
