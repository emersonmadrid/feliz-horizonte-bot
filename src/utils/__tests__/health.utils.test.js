import { describe, expect, it } from "vitest";
import { buildHealthPayload, getBotMode } from "../health.utils.js";

describe("getBotMode", () => {
  it("retorna webhook cuando useWebhook es true", () => {
    expect(getBotMode(true)).toBe("webhook");
  });

  it("retorna polling cuando useWebhook es false", () => {
    expect(getBotMode(false)).toBe("polling");
  });
});

describe("buildHealthPayload", () => {
  it("marca ok solo si ambos servicios están ok", () => {
    const payload = buildHealthPayload({
      supabaseStatus: { ok: true },
      telegramStatus: { ok: true },
      mode: "polling",
    });

    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("polling");
  });

  it("incluye datos extra y conserva estados", () => {
    const payload = buildHealthPayload({
      supabaseStatus: { ok: false, error: "timeout" },
      telegramStatus: { ok: true, username: "fh_bot" },
      mode: "webhook",
      extra: { timestamp: "2024-01-01T00:00:00.000Z" },
    });

    expect(payload.ok).toBe(false);
    expect(payload.supabase.error).toBe("timeout");
    expect(payload.telegram.username).toBe("fh_bot");
    expect(payload.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });
});
