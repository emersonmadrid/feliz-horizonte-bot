import { describe, expect, it } from "vitest";
import {
  getActiveAppointmentIds,
  reconcileCalendlyApiSnapshot,
} from "../reconciliation.js";

describe("reconcileCalendlyApiSnapshot", () => {
  it("marks future Calendly appointments missing from the active API snapshot as cancelled", async () => {
    const calls = [];

    const result = await reconcileCalendlyApiSnapshot(
      { timezone: "America/Lima" },
      [{ id: "calendly:new-event:new-invitee" }],
      {
        cancelMissingAppointments: async (config, activeAppointmentIds) => {
          calls.push({ config, activeAppointmentIds });
          return 1;
        },
      }
    );

    expect(calls.length).toBe(1);
    expect(JSON.stringify(calls[0].activeAppointmentIds)).toBe(
      JSON.stringify(["calendly:new-event:new-invitee"])
    );
    expect(JSON.stringify(result)).toBe(
      JSON.stringify({
        source: "calendly_api",
        activeAppointmentIds: ["calendly:new-event:new-invitee"],
        activeCount: 1,
        cancelledMissingCount: 1,
      })
    );
  });

  it("keeps multiple active appointments for the same patient and day as separate appointments", async () => {
    const appointments = [
      { id: "calendly:event-9:invitee-1", patientEmail: "ana@example.com" },
      { id: "calendly:event-13:invitee-2", patientEmail: "ana@example.com" },
      { id: "calendly:event-18:invitee-3", patientEmail: "ana@example.com" },
    ];
    const activeAppointmentIdsSeen = [];

    const result = await reconcileCalendlyApiSnapshot(
      {},
      appointments,
      {
        cancelMissingAppointments: async (_config, activeAppointmentIds) => {
          activeAppointmentIdsSeen.push(...activeAppointmentIds);
          return 0;
        },
      }
    );

    expect(JSON.stringify(activeAppointmentIdsSeen)).toBe(
      JSON.stringify(appointments.map((appointment) => appointment.id))
    );
    expect(result.activeCount).toBe(3);
    expect(result.cancelledMissingCount).toBe(0);
  });

  it("ignores malformed appointments without an id when building the active snapshot", () => {
    expect(JSON.stringify(getActiveAppointmentIds([{ id: "ok" }, {}, { id: null }]))).toBe(
      JSON.stringify(["ok"])
    );
  });
});
