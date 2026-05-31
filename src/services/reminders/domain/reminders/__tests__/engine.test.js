import { describe, expect, it } from "vitest";
import { buildDryRunSummary, createDryRunEntry } from "../engine.js";

describe("buildDryRunSummary", () => {
  it("reports pending reminders without marking them as sent", () => {
    const dayAppointment = {
      id: "appointment-day",
      patientName: "Ana Torres",
      patientEmail: "ana@example.com",
      patientPhone: "51999999999",
      startsAt: "2026-06-01T09:00:00-05:00",
    };
    const hourAppointment = {
      id: "appointment-hour",
      patientName: "Luis Perez",
      patientEmail: "luis@example.com",
      patientPhone: "51888888888",
      startsAt: "2026-06-01T10:00:00-05:00",
    };

    const summary = buildDryRunSummary([dayAppointment], [hourAppointment]);

    expect(summary.ok).toBe(true);
    expect(summary.dryRun).toBe(true);
    expect(summary.checked.day).toBe(1);
    expect(summary.checked.hour).toBe(1);
    expect(summary.sent.length).toBe(0);
    expect(summary.failed.length).toBe(0);
    expect(summary.skipped.length).toBe(2);
    expect(summary.skipped[0].reason).toBe("dry_run");
    expect(summary.skipped[0].id).toBe("appointment-day");
    expect(summary.skipped[1].type).toBe("hour");
  });
});

describe("createDryRunEntry", () => {
  it("keeps enough appointment data to verify a real test run", () => {
    const entry = createDryRunEntry(
      {
        id: "appointment-1",
        patientName: "Ana Torres",
        patientEmail: "ana@example.com",
        patientPhone: "51999999999",
        startsAt: "2026-06-01T09:00:00-05:00",
      },
      "day"
    );

    expect(entry.id).toBe("appointment-1");
    expect(entry.type).toBe("day");
    expect(entry.reason).toBe("dry_run");
    expect(entry.patientEmail).toBe("ana@example.com");
    expect(entry.patientPhone).toBe("51999999999");
  });
});
