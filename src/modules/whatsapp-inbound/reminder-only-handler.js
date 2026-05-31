import {
  buildReminderOnlyMessage,
  normalizeRedirectPhone,
  summarizeInboundMessage,
} from "./router.js";

export async function handleReminderOnlyInbound({
  from,
  text,
  type,
  env = process.env,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger = null,
}) {
  if (!from) {
    throw new Error("from is required");
  }

  if (typeof sendWhatsAppText !== "function") {
    throw new Error("sendWhatsAppText dependency is required");
  }

  const incomingTelegramLine = summarizeInboundMessage({ text, type });
  const reminderOnlyMessage = buildReminderOnlyMessage({
    redirectPhone: env.REDIRECT_PHONE,
  });

  await sendWhatsAppText(from, reminderOnlyMessage);

  if (typeof notifyTelegram === "function") {
    await notifyTelegram("ℹ️ REDIRECCIÓN AUTOMÁTICA", [
      incomingTelegramLine,
      "🔒 El bot está en modo 'Solo Recordatorios'. Se envió mensaje de redirección.",
    ], from);
  }

  if (typeof auditLogger === "function") {
    await auditLogger({
      phone: from,
      messageText: text || null,
      messageType: type || "unknown",
      route: "reminder_only",
      action: "auto_redirect",
      status: "handled",
      metadata: {
        redirectPhone: normalizeRedirectPhone(env.REDIRECT_PHONE),
      },
    });
  }

  return {
    route: "reminder_only",
    action: "auto_redirect",
    from,
    message: reminderOnlyMessage,
  };
}
