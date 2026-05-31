import { describe, expect, it } from "vitest";
import { handleReminderOnlyInbound } from "../reminder-only-handler.js";

describe("handleReminderOnlyInbound", () => {
  it("responde con redirección y notifica sin tocar chatbot", async () => {
    const sent = [];
    const notifications = [];
    const audits = [];

    const result = await handleReminderOnlyInbound({
      from: "51936597327",
      text: "Estoy abajo",
      type: "text",
      env: { REDIRECT_PHONE: "+51 922 346 747" },
      sendWhatsAppText: async (to, message) => {
        sent.push({ to, message });
      },
      notifyTelegram: async (title, lines, phone) => {
        notifications.push({ title, lines, phone });
      },
      auditLogger: async (payload) => {
        audits.push(payload);
      },
    });

    expect(result.route).toBe("reminder_only");
    expect(result.action).toBe("auto_redirect");
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe("51936597327");
    expect(sent[0].message).toContain("solo para *recordatorios*");
    expect(sent[0].message).toContain("wa.me/51922346747");
    expect(notifications.length).toBe(1);
    expect(notifications[0].lines[0]).toBe('💬 "Estoy abajo"');
    expect(audits.length).toBe(1);
    expect(audits[0].phone).toBe("51936597327");
    expect(audits[0].messageText).toBe("Estoy abajo");
    expect(audits[0].messageType).toBe("text");
    expect(audits[0].route).toBe("reminder_only");
    expect(audits[0].action).toBe("auto_redirect");
    expect(audits[0].status).toBe("handled");
    expect(audits[0].metadata.redirectPhone).toBe("51922346747");
  });
});
