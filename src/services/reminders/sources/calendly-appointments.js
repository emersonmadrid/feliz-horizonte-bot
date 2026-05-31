import {
  cancelAppointment,
  cancelMissingCalendlyAppointments,
  upsertAppointments,
} from "../persistence/appointments.js";
import { logReminderDiagnostic } from "../persistence/message-log.js";
import { fetchPatientsSheet } from "../integrations/google/sheets.js";
import {
  fetchCalendlyCurrentUser,
  fetchCalendlyEventInvitees,
  fetchCalendlyScheduledEvents,
} from "../integrations/calendly/client.js";

const PHONE_HINTS = [
  "telefono",
  "teléfono",
  "celular",
  "whatsapp",
  "phone",
  "mobile",
];

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return digits;
}

function getLastUriPart(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  return raw.split("/").filter(Boolean).at(-1) || raw;
}

function getEventType(payload) {
  return String(payload?.event || "").trim();
}

function getInvitee(payload) {
  return payload?.payload || {};
}

function getScheduledEvent(invitee) {
  return invitee?.scheduled_event || {};
}

function buildWebhookInviteeFromScheduledEvent(event, invitee) {
  return {
    ...invitee,
    scheduled_event: {
      uri: event.uri,
      uuid: event.uuid,
      name: event.name,
      start_time: event.start_time,
      end_time: event.end_time,
      timezone: event.timezone,
      status: event.status,
    },
  };
}

function getAppointmentId(invitee) {
  const scheduledEvent = getScheduledEvent(invitee);
  const eventId = getLastUriPart(scheduledEvent.uri || scheduledEvent.uuid);
  const inviteeId = getLastUriPart(invitee.uri || invitee.uuid);
  return `calendly:${eventId || "event"}:${inviteeId || "invitee"}`;
}

function getSourceEventId(invitee) {
  const scheduledEvent = getScheduledEvent(invitee);
  return getLastUriPart(scheduledEvent.uri || scheduledEvent.uuid) || getAppointmentId(invitee);
}

function findPhoneInQuestions(invitee) {
  const answers = invitee.questions_and_answers || invitee.questions_and_responses || [];

  for (const item of answers) {
    const question = String(item.question || item.name || "").toLowerCase();
    const answer = item.answer ?? item.response;
    if (PHONE_HINTS.some((hint) => question.includes(hint))) {
      const normalized = normalizePhone(answer);
      if (normalized) return normalized;
    }
  }

  return null;
}

function getPatientPhone(invitee) {
  return normalizePhone(invitee.text_reminder_number) ||
    normalizePhone(invitee.phone_number) ||
    findPhoneInQuestions(invitee);
}

function getCalendarStatus(eventType, invitee) {
  if (eventType === "invitee.canceled" || invitee.canceled === true) {
    return "cancelled";
  }

  return getScheduledEvent(invitee).status || "confirmed";
}

function buildEligibility({ eventType, invitee, patientEmail, patientPhone, patientMatch }) {
  if (eventType === "invitee.canceled" || invitee.canceled === true) {
    return {
      eligibilityStatus: "cancelled",
      skipReason: "appointment_cancelled",
      errorMessage: null,
    };
  }

  if (!patientEmail) {
    return {
      eligibilityStatus: "unmatched",
      skipReason: "calendly_invitee_missing_email",
      errorMessage: "Calendly invitee has no email.",
    };
  }

  if (!patientMatch) {
    return {
      eligibilityStatus: "unmatched",
      skipReason: "calendly_patient_email_not_found",
      errorMessage: "Calendly invitee email was not found in the patient sheet.",
    };
  }

  if (!patientPhone) {
    return {
      eligibilityStatus: "invalid_contact",
      skipReason: "patient_phone_invalid",
      errorMessage: "Patient match exists, but the phone is missing or invalid in the patient sheet.",
    };
  }

  return {
    eligibilityStatus: "eligible",
    skipReason: null,
    errorMessage: null,
  };
}

export function normalizeCalendlyWebhookEvent(config, body, patientsByEmail = new Map()) {
  const eventType = getEventType(body);
  const invitee = getInvitee(body);
  const scheduledEvent = getScheduledEvent(invitee);
  const startsAt = scheduledEvent.start_time || invitee.start_time;

  if (!eventType) {
    throw new Error("Calendly webhook payload missing event.");
  }

  if (!startsAt) {
    throw new Error("Calendly webhook payload missing scheduled_event.start_time.");
  }

  const patientEmail = normalizeEmail(invitee.email);
  const patientMatch = patientEmail ? patientsByEmail.get(patientEmail) : null;
  const calendlyPhone = getPatientPhone(invitee);
  const sheetPhone = normalizePhone(patientMatch?.phone);
  const patientPhone = sheetPhone || calendlyPhone;
  const patientName = patientMatch?.fullName || invitee.name || scheduledEvent.name || patientEmail;
  const eligibility = buildEligibility({
    eventType,
    invitee,
    patientEmail,
    patientPhone,
    patientMatch,
  });

  return {
    id: getAppointmentId(invitee),
    source: "calendly",
    sourceEventId: getSourceEventId(invitee),
    startsAt,
    timezone: scheduledEvent.timezone || invitee.timezone || config.calendlyTimezone || config.timezone,
    calendarStatus: getCalendarStatus(eventType, invitee),
    patientName,
    patientEmail,
    patientPhone,
    rawEvent: {
      event: eventType,
      inviteeUri: invitee.uri || null,
      scheduledEventUri: scheduledEvent.uri || null,
      scheduledEventName: scheduledEvent.name || null,
      startsAt,
      inviteeEmail: patientEmail,
      phoneSource: sheetPhone ? "google_sheet" : calendlyPhone ? "calendly" : null,
      raw: body,
    },
    ...eligibility,
  };
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

export async function handleCalendlyWebhook(config, body) {
  const patientsByEmail = await fetchPatientsSheet(config);
  const appointment = normalizeCalendlyWebhookEvent(config, body, patientsByEmail);

  if (appointment.calendarStatus === "cancelled") {
    const updated = await cancelAppointment(config, appointment.id, appointment.rawEvent);
    if (!updated) {
      await upsertAppointments(config, [appointment]);
    }
  } else {
    await upsertAppointments(config, [appointment]);
  }

  await logIneligibleAppointment(config, appointment);

  return appointment;
}

export function normalizeCalendlyScheduledEvent(config, event, invitee, patientsByEmail = new Map()) {
  return normalizeCalendlyWebhookEvent(
    config,
    {
      event: invitee.canceled ? "invitee.canceled" : "invitee.created",
      payload: buildWebhookInviteeFromScheduledEvent(event, invitee),
    },
    patientsByEmail
  );
}

async function resolveCalendlyIdentity(config) {
  if (config.calendlyUserUri && config.calendlyOrganizationUri) {
    return {
      userUri: config.calendlyUserUri,
      organizationUri: config.calendlyOrganizationUri,
    };
  }

  const user = await fetchCalendlyCurrentUser(config);
  return {
    userUri: user.uri,
    organizationUri: user.current_organization,
  };
}

export async function syncCalendlyApiAppointments(config) {
  const [{ userUri, organizationUri }, patientsByEmail] = await Promise.all([
    resolveCalendlyIdentity(config),
    fetchPatientsSheet(config),
  ]);

  const events = await fetchCalendlyScheduledEvents(config, { userUri, organizationUri });
  const appointments = [];

  for (const event of events) {
    const invitees = await fetchCalendlyEventInvitees(config, event.uri);
    for (const invitee of invitees) {
      appointments.push(normalizeCalendlyScheduledEvent(config, event, invitee, patientsByEmail));
    }
  }

  await upsertAppointments(config, appointments);
  const cancelledStaleCount = await cancelMissingCalendlyAppointments(
    config,
    appointments.map((appointment) => appointment.id)
  );

  if (cancelledStaleCount > 0) {
    console.log(`📅 Calendly API sync: ${cancelledStaleCount} cita(s) futuras ausentes marcadas como canceladas`);
  }

  for (const appointment of appointments) {
    await logIneligibleAppointment(config, appointment);
  }

  return appointments;
}
