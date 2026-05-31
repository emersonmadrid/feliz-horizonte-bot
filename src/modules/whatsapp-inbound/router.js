export const WHATSAPP_INBOUND_ROUTES = {
  REMINDER_ONLY: "reminder_only",
  CHATBOT: "chatbot",
};

function clean(value) {
  return String(value || "").trim();
}

export function getWhatsappInboundRoute(env = process.env) {
  const mode = clean(env.GLOBAL_MODE).toLowerCase();

  if (mode === "reminders") {
    return WHATSAPP_INBOUND_ROUTES.REMINDER_ONLY;
  }

  return WHATSAPP_INBOUND_ROUTES.CHATBOT;
}

export function shouldUseReminderOnlyHandler(env = process.env) {
  return getWhatsappInboundRoute(env) === WHATSAPP_INBOUND_ROUTES.REMINDER_ONLY;
}

export function normalizeRedirectPhone(value) {
  return clean(value || "+51 922 346 747").replace(/\D/g, "");
}

export function buildReminderOnlyMessage({ redirectPhone } = {}) {
  const cleanPhone = normalizeRedirectPhone(redirectPhone);

  return (
    "¡Hola! 😊 Este número es solo para *recordatorios*.\n\n" +
    "Para citas o consultas, escríbenos aquí:\n" +
    `📲 wa.me/${cleanPhone}\n\n` +
    "¡Estaremos felices de atenderte! 💙"
  );
}

export function summarizeInboundMessage({ text, type }) {
  const messageType = clean(type || "text");
  const body = clean(text);

  if (body) {
    return `💬 "${body}"`;
  }

  return `💬 Mensaje recibido sin texto (tipo: ${messageType})`;
}
