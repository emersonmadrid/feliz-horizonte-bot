import { describe, expect, it } from "vitest";
import { safeLogInboundAudit } from "../inbound-audit.js";

describe("safeLogInboundAudit", () => {
  it("no falla si no hay DATABASE_URL", async () => {
    const result = await safeLogInboundAudit({}, {
      phone: "51936597327",
      route: "reminder_only",
      action: "auto_redirect",
    });

    expect(result).toBe(null);
  });
});
