export const WHATSAPP_INBOUND_ROUTES = {
  STAFF_INTAKE: "staff_intake",
  REMINDER_ONLY: "reminder_only",
  CHATBOT: "chatbot",
};

function clean(value) {
  return String(value || "").trim();
}

export function isStaffIntakeMessage({ text, from, env = process.env } = {}) {
  if (!text || !from) return false;

  const authorizedPhones = (env.AUTHORIZED_STAFF_PHONES || "51922346747,51936597327")
    .split(",")
    .map((p) => p.trim().replace(/\D/g, ""))
    .filter(Boolean);

  const cleanFrom = String(from).replace(/\D/g, "");
  const isStaff = authorizedPhones.some(
    (phone) => cleanFrom.includes(phone) || phone.includes(cleanFrom)
  );

  if (!isStaff) return false;

  const cleanBody = text.toLowerCase();
  if (
    cleanBody.startsWith("#alta") ||
    cleanBody.startsWith("#registro") ||
    cleanBody.startsWith("/alta") ||
    cleanBody.startsWith("/registro")
  ) {
    return true;
  }

  const hasName =
    cleanBody.includes("nombre completo:") ||
    cleanBody.includes("nombre:") ||
    cleanBody.includes("✅ nombre");

  const hasPhoneOrDate =
    cleanBody.includes("celular:") ||
    cleanBody.includes("teléfono:") ||
    cleanBody.includes("telefono:") ||
    cleanBody.includes("nacimiento:");

  if (hasName && hasPhoneOrDate) {
    return true;
  }

  // 3. Conversación o mensaje reenviado de WhatsApp (timestamps [14:20] o 14:20 -)
  const isForwardedChat =
    /\[\d{1,2}:\d{2}/.test(text) ||
    /\d{1,2}:\d{2}\s*-\s*/.test(text);

  if (isForwardedChat) {
    return true;
  }

  // 4. Reenvío directo de mensaje del paciente con email y teléfono
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  const hasPhone = /\b9\d{8}\b/.test(text) || /\b\d{9}\b/.test(text);

  if (hasEmail && hasPhone) {
    return true;
  }

  return false;
}

export function getWhatsappInboundRoute({ text, from, env = process.env } = {}) {
  if (isStaffIntakeMessage({ text, from, env })) {
    return WHATSAPP_INBOUND_ROUTES.STAFF_INTAKE;
  }

  const mode = clean(env.GLOBAL_MODE).toLowerCase();
  if (mode === "reminders") {
    return WHATSAPP_INBOUND_ROUTES.REMINDER_ONLY;
  }

  return WHATSAPP_INBOUND_ROUTES.CHATBOT;
}

export function shouldUseReminderOnlyHandler(env = process.env) {
  const mode = clean(env.GLOBAL_MODE).toLowerCase();
  return mode === "reminders";
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
