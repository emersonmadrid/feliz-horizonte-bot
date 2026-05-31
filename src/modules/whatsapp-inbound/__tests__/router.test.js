import { describe, expect, it } from "vitest";
import {
  buildReminderOnlyMessage,
  getWhatsappInboundRoute,
  normalizeRedirectPhone,
  shouldUseReminderOnlyHandler,
  summarizeInboundMessage,
  WHATSAPP_INBOUND_ROUTES,
} from "../router.js";

describe("getWhatsappInboundRoute", () => {
  it("envía a reminder_only cuando GLOBAL_MODE es reminders", () => {
    expect(getWhatsappInboundRoute({ GLOBAL_MODE: "reminders" })).toBe(
      WHATSAPP_INBOUND_ROUTES.REMINDER_ONLY
    );
  });

  it("envía a chatbot por defecto", () => {
    expect(getWhatsappInboundRoute({})).toBe(WHATSAPP_INBOUND_ROUTES.CHATBOT);
    expect(getWhatsappInboundRoute({ GLOBAL_MODE: "chat" })).toBe(
      WHATSAPP_INBOUND_ROUTES.CHATBOT
    );
  });
});

describe("shouldUseReminderOnlyHandler", () => {
  it("activa el corte temprano solo en modo reminders", () => {
    expect(shouldUseReminderOnlyHandler({ GLOBAL_MODE: "reminders" })).toBe(true);
    expect(shouldUseReminderOnlyHandler({ GLOBAL_MODE: "chat" })).toBe(false);
  });
});

describe("buildReminderOnlyMessage", () => {
  it("normaliza el teléfono de redirección para wa.me", () => {
    expect(normalizeRedirectPhone("+51 922 346 747")).toBe("51922346747");
    expect(buildReminderOnlyMessage({ redirectPhone: "+51 922 346 747" })).toContain(
      "wa.me/51922346747"
    );
  });
});

describe("summarizeInboundMessage", () => {
  it("resume texto entrante", () => {
    expect(summarizeInboundMessage({ text: "Hola", type: "text" })).toBe('💬 "Hola"');
  });

  it("resume mensajes sin texto", () => {
    expect(summarizeInboundMessage({ text: "", type: "image" })).toBe(
      "💬 Mensaje recibido sin texto (tipo: image)"
    );
  });
});
