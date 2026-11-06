/**
 * src/modules/whatsapp-inbound/intake-handler.js
 * 
 * Channel Adapter (Gateway) para Admisión e Historia Clínica de Staff.
 * Arquitectura Limpia: Delega al microservicio independiente feliz-horizonte-intake vía HTTP.
 */

const DEFAULT_INTAKE_URL = "https://feliz-horizonte-intake.vercel.app";
const DEFAULT_API_KEY = "fh_intake_dev_secret_key_2026";

export async function handleStaffIntakeInbound({
  from,
  text,
  buttonSelection = null,
  env = process.env,
  sendWhatsAppText = null,
  sendWhatsAppButtons = null,
  notifyTelegram = null,
  auditLogger = null,
}) {
  console.log(`📋 [STAFF INTAKE GATEWAY] Mensaje de ${from}: "${text?.slice(0, 60)}" (button: ${buttonSelection || "none"})`);

  const intakeUrl = (env.INTAKE_SERVICE_URL || DEFAULT_INTAKE_URL).replace(/\/$/, "");
  const apiKey = env.INTAKE_API_KEY || DEFAULT_API_KEY;

  try {
    const res = await fetch(`${intakeUrl}/api/staff-intake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, text, buttonSelection }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Microservicio HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    console.log(`✅ [GATEWAY] Microservicio respondió OK: ${data.action || "success"}`);

    // Si la respuesta incluye botones interactivos y el canal los soporta
    if (data.buttons && Array.isArray(data.buttons) && data.buttons.length > 0 && typeof sendWhatsAppButtons === "function") {
      const promptBody = data.replyText?.split("\n\n")?.[0] || "¿Qué deseas realizar?";
      await sendWhatsAppButtons(from, promptBody, data.buttons);
    } else if (data.replyText && typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, data.replyText);
    }

    if (typeof auditLogger === "function") {
      try {
        await auditLogger({
          phone: from,
          messageText: text || null,
          route: "staff_intake",
          action: data.action || "intake_processed",
          status: "success",
        });
      } catch (err) {
        console.warn("⚠️ Error en auditLogger staff intake:", err.message);
      }
    }

    return data;
  } catch (err) {
    console.error("❌ [GATEWAY] Error al delegar al microservicio intake:", err.message);

    const fallbackMsg = "⚠️ El servicio de admisión está en mantenimiento momentáneo. Por favor, intenta en unos minutos.";
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, fallbackMsg);
    }

    if (typeof notifyTelegram === "function") {
      await notifyTelegram(
        "⚠️ ALERTA: MICROSERVICIO INTAKE NO RESPONDE",
        [
          `Remitente: ${from}`,
          `Mensaje: ${text || buttonSelection || "N/A"}`,
          `Error: ${err.message}`,
        ],
        from
      );
    }

    return { ok: false, error: err.message };
  }
}
