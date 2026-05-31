import { describe, expect, it } from "vitest";
import { buildNormalizedGoogleAppointmentRows } from "../google-appointments.js";

const config = {
  timezone: "America/Lima",
  googleCalendarTimezone: "America/Lima",
};

describe("buildNormalizedGoogleAppointmentRows", () => {
  it("normaliza citas elegibles desde Calendar y Sheet", () => {
    const events = [{
      eventId: "abc123",
      startsAt: "2026-05-20T15:00:00-05:00",
      status: "confirmed",
      inviteeEmail: "ana@example.com",
      summary: "Ana cita",
    }];

    const patientsByEmail = new Map([
      ["ana@example.com", {
        fullName: "Ana Torres",
        phone: "+51 999 888 777",
      }],
    ]);

    const rows = buildNormalizedGoogleAppointmentRows(config, events, patientsByEmail);

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("gcal:abc123");
    expect(rows[0].patientName).toBe("Ana Torres");
    expect(rows[0].patientPhone).toBe("51999888777");
    expect(rows[0].eligibilityStatus).toBe("eligible");
    expect(rows[0].skipReason).toBe(null);
  });

  it("registra unmatched cuando el evento no tiene email", () => {
    const rows = buildNormalizedGoogleAppointmentRows(config, [{
      eventId: "no-email",
      startsAt: "2026-05-20T15:00:00-05:00",
      status: "confirmed",
      inviteeEmail: null,
      summary: "Sin correo",
    }], new Map());

    expect(rows[0].eligibilityStatus).toBe("unmatched");
    expect(rows[0].skipReason).toBe("calendar_event_missing_email");
  });

  it("registra invalid_contact cuando el teléfono es inválido", () => {
    const rows = buildNormalizedGoogleAppointmentRows(config, [{
      eventId: "bad-phone",
      startsAt: "2026-05-20T15:00:00-05:00",
      status: "confirmed",
      inviteeEmail: "bad@example.com",
      summary: "Mal telefono",
    }], new Map([
      ["bad@example.com", {
        fullName: "Paciente Sin Telefono",
        phone: "abc",
      }],
    ]));

    expect(rows[0].eligibilityStatus).toBe("invalid_contact");
    expect(rows[0].skipReason).toBe("patient_phone_invalid");
  });
});
