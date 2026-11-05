import { loadConfig } from "./intake/core/config.js";
import { processPatientIntake } from "./intake/services/intake-orchestrator.js";

export async function handleStaffIntakeInbound({
  from,
  text,
  env = process.env,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger = null,
}) {
  console.log(`📋 [STAFF INTAKE] Procesando admisión desde: ${from}`);

  try {
    const config = loadConfig(env);
    const intakeResult = await processPatientIntake({
      text,
      from,
      senderName: "Staff Feliz Horizonte",
      config,
    });

    const responseText = intakeResult.responseText || "✅ Paciente procesado con éxito.";

    // Envío de confirmación mediante el método oficial inyectado
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, responseText);
    }

    // Notificación operativa a Telegram si el registro fue exitoso
    if (typeof notifyTelegram === "function" && intakeResult.success) {
      const patient = intakeResult.patient || {};
      await notifyTelegram("📋 NUEVO PACIENTE REGISTRADO", [
        `ID: #${intakeResult.result?.id || "N/A"}`,
        `Nombre: ${intakeResult.result?.fullName || patient.nombre || "N/A"}`,
        `Teléfono: ${patient.telefono || "N/A"}`,
        `Registrado por: WhatsApp ${from}`,
      ], from);
    }

    // Auditoría si existe logger configurado
    if (typeof auditLogger === "function") {
      await auditLogger({
        phone: from,
        messageText: text || null,
        messageType: "text",
        route: "staff_intake",
        action: intakeResult.success ? "patient_registered" : "intake_validation_failed",
        status: intakeResult.success ? "handled" : "error",
        metadata: {
          patientId: intakeResult.result?.id,
          success: intakeResult.success,
        },
      });
    }

    return { ok: intakeResult.success, data: intakeResult };
  } catch (err) {
    console.error("❌ Error en handleStaffIntakeInbound:", err.message);

    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(
        from,
        `⚠️ No se pudo completar el registro: ${err.message}`
      );
    }

    if (typeof auditLogger === "function") {
      await auditLogger({
        phone: from,
        messageText: text || null,
        messageType: "text",
        route: "staff_intake",
        action: "intake_error",
        status: "error",
        metadata: { error: err.message },
      });
    }

    return { ok: false, error: err.message };
  }
}
