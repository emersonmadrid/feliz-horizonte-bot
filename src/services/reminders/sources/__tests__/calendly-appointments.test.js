import { describe, expect, it } from "vitest";
import {
  normalizeCalendlyScheduledEvent,
  normalizeCalendlyWebhookEvent,
} from "../calendly-appointments.js";

const config = {
  timezone: "America/Lima",
  calendlyTimezone: "America/Lima",
};

const patientsByEmail = new Map([
  ["ana@example.com", {
    fullName: "Ana Torres Sheet",
    phone: "936 597 327",
  }],
]);

function createPayload(overrides = {}) {
  return {
    event: "invitee.created",
    payload: {
      uri: "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
      name: "Ana Torres",
      email: "ANA@example.com",
      text_reminder_number: "+51 999 888 777",
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/event-1",
        name: "Terapia individual",
        start_time: "2026-05-20T15:00:00-05:00",
        timezone: "America/Lima",
        status: "active",
      },
      ...overrides,
    },
  };
}

describe("normalizeCalendlyWebhookEvent", () => {
  it("normaliza invitee.created como cita elegible", () => {
    const appointment = normalizeCalendlyWebhookEvent(config, createPayload(), patientsByEmail);

    expect(appointment.id).toBe("calendly:event-1:invitee-1");
    expect(appointment.source).toBe("calendly");
    expect(appointment.sourceEventId).toBe("event-1");
    expect(appointment.patientName).toBe("Ana Torres Sheet");
    expect(appointment.patientEmail).toBe("ana@example.com");
    expect(appointment.patientPhone).toBe("936597327");
    expect(appointment.eligibilityStatus).toBe("eligible");
  });

  it("usa teléfono de Calendly si no hay teléfono en Sheet", () => {
    const appointment = normalizeCalendlyWebhookEvent(config, createPayload({
      text_reminder_number: null,
      questions_and_answers: [
        { question: "Número de WhatsApp", answer: "936 597 327" },
      ],
    }), new Map([
      ["ana@example.com", {
        fullName: "Ana Torres",
        phone: "",
      }],
    ]));

    expect(appointment.patientPhone).toBe("936597327");
    expect(appointment.eligibilityStatus).toBe("eligible");
  });

  it("marca unmatched si el correo de Calendly no existe en Sheet", () => {
    const appointment = normalizeCalendlyWebhookEvent(config, createPayload(), new Map());

    expect(appointment.eligibilityStatus).toBe("unmatched");
    expect(appointment.skipReason).toBe("calendly_patient_email_not_found");
  });

  it("marca invalid_contact si existe en Sheet pero falta teléfono", () => {
    const appointment = normalizeCalendlyWebhookEvent(config, createPayload({
      text_reminder_number: null,
      phone_number: null,
      questions_and_answers: [],
    }), new Map([
      ["ana@example.com", {
        fullName: "Ana Torres",
        phone: "",
      }],
    ]));

    expect(appointment.eligibilityStatus).toBe("invalid_contact");
    expect(appointment.skipReason).toBe("patient_phone_invalid");
  });

  it("marca cancelada una cita de invitee.canceled", () => {
    const appointment = normalizeCalendlyWebhookEvent(config, {
      ...createPayload(),
      event: "invitee.canceled",
    }, patientsByEmail);

    expect(appointment.calendarStatus).toBe("cancelled");
    expect(appointment.eligibilityStatus).toBe("cancelled");
    expect(appointment.skipReason).toBe("appointment_cancelled");
  });

  it("normaliza eventos leídos por Calendly API", () => {
    const appointment = normalizeCalendlyScheduledEvent(
      config,
      {
        uri: "https://api.calendly.com/scheduled_events/event-2",
        name: "Sesión Psicológica",
        start_time: "2026-05-21T10:00:00-05:00",
        timezone: "America/Lima",
        status: "active",
      },
      {
        uri: "https://api.calendly.com/scheduled_events/event-2/invitees/invitee-2",
        name: "Ana Torres",
        email: "ana@example.com",
      },
      patientsByEmail
    );

    expect(appointment.id).toBe("calendly:event-2:invitee-2");
    expect(appointment.source).toBe("calendly");
    expect(appointment.patientPhone).toBe("936597327");
    expect(appointment.startsAt).toBe("2026-05-21T10:00:00-05:00");
    expect(appointment.eligibilityStatus).toBe("eligible");
  });
});
