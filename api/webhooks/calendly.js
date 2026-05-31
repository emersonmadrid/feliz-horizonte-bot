import { loadConfig } from "../../src/services/reminders/core/config.js";
import { handleCalendlyWebhook } from "../../src/services/reminders/sources/calendly-appointments.js";

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function validateCalendlySecret(req, config) {
  if (!config.calendlyWebhookSecret) {
    return true;
  }

  const querySecret = req.query?.token;
  const headerSecret = getHeader(req, "x-calendly-webhook-secret");

  return querySecret === config.calendlyWebhookSecret || headerSecret === config.calendlyWebhookSecret;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const config = loadConfig();

    if (!validateCalendlySecret(req, config)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const appointment = await handleCalendlyWebhook(config, req.body);

    return res.status(200).json({
      ok: true,
      appointmentId: appointment.id,
      source: appointment.source,
      status: appointment.calendarStatus,
      eligibilityStatus: appointment.eligibilityStatus,
    });
  } catch (error) {
    console.error("❌ Error processing Calendly webhook:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
