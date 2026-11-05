import { loadConfig } from "./intake/core/config.js";
import { processPatientIntake } from "./intake/services/intake-orchestrator.js";
import {
  getConversationState,
  mergeConversationState,
  deleteConversationState,
} from "../../services/state.service.js";

const DRAFT_TTL_MS = 15 * 60 * 1000; // 15 minutos para completar un registro por partes

export async function handleStaffIntakeInbound({
  from,
  text,
  env = process.env,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger = null,
}) {
  console.log(`📋 [STAFF INTAKE] Mensaje recibido de ${from}: "${text?.slice(0, 60)}"`);

  const stateKey = `staff_intake:${from}`;
  const cleanBody = (text || "").trim().toLowerCase();

  // 1. Comando explícito de cancelación
  if (cleanBody === "#cancelar" || cleanBody === "/cancelar" || cleanBody === "#anular") {
    await deleteConversationState(stateKey);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(
        from,
        "🗑️ *Registro cancelado.*\nSe ha descartado el borrador actual. Puedes iniciar uno nuevo cuando desees con `#alta`."
      );
    }
    return { ok: true, cancelled: true };
  }

  // 2. Revisar si existe un borrador previo no expirado
  const now = Date.now();
  let existingState = null;
  try {
    existingState = await getConversationState(stateKey);
  } catch (err) {
    console.warn("⚠️ No se pudo consultar borrador en state service:", err.message);
  }

  const existingDraft = existingState?.intakeDraft;
  let combinedText = text;

  const isExplicitNewStart = /^(#|\/)(alta|registro)/i.test(text.trim());

  if (
    existingDraft?.text &&
    now - (existingDraft.updatedAt || 0) < DRAFT_TTL_MS &&
    !isExplicitNewStart
  ) {
    combinedText = `${existingDraft.text}\n${text}`;
    console.log(`🧩 Combinando mensaje con borrador activo de ${from}`);
  }

  try {
    const config = loadConfig(env);

    // Ejecutamos la extracción y validación
    const intakeResult = await processPatientIntake({
      text: combinedText,
      from: null, // Evita envío duplicado interno en el orquestador
      senderName: "Staff Feliz Horizonte",
      config,
    });

    // 3. Caso A: Registro Exitoso
    if (intakeResult.success) {
      // Limpiamos el borrador completado
      await deleteConversationState(stateKey);

      const responseText = intakeResult.responseText || "✅ Paciente registrado con éxito.";

      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, responseText);
      }

      if (typeof notifyTelegram === "function") {
        const p = intakeResult.patient || {};
        await notifyTelegram(
          "📋 NUEVO PACIENTE REGISTRADO",
          [
            `ID: #${intakeResult.result?.id || "N/A"}`,
            `Nombre: ${intakeResult.result?.fullName || p.nombre || "N/A"}`,
            `Celular: ${p.telefono || "N/A"}`,
            `Email: ${p.email || "N/A"}`,
            `Registrado por: WhatsApp ${from}`,
          ],
          from
        );
      }

      if (typeof auditLogger === "function") {
        await auditLogger({
          phone: from,
          messageText: combinedText,
          messageType: "text",
          route: "staff_intake",
          action: "patient_registered",
          status: "handled",
          metadata: {
            patientId: intakeResult.result?.id,
            success: true,
          },
        });
      }

      return { ok: true, data: intakeResult };
    }

    // 4. Caso B: Faltan datos obligatorios (Validación incompleta)
    if (intakeResult.reason === "validation_failed") {
      // Guardamos lo acumulado en memoria para que el siguiente mensaje lo complete
      await mergeConversationState(stateKey, {
        intakeDraft: {
          text: combinedText,
          updatedAt: now,
          patient: intakeResult.patient,
        },
      });

      const p = intakeResult.patient || {};
      const recopilado = [];
      const fullName = `${p.nombre || ""} ${p.apellidos || ""}`.trim();
      if (fullName) recopilado.push(`• Nombre: *${fullName}*`);
      if (p.telefono) recopilado.push(`• Celular: *${p.telefono}*`);
      if (p.email) recopilado.push(`• Email: *${p.email}*`);
      if (p.fechaNacimiento) recopilado.push(`• F. Nac: *${p.fechaNacimiento}*`);

      let guidanceMsg = `📝 *Anoté los siguientes datos:*`;
      if (recopilado.length > 0) {
        guidanceMsg += `\n${recopilado.join("\n")}`;
      } else {
        guidanceMsg += `\n_(Aún no identifico el nombre del paciente)_`;
      }

      guidanceMsg += `\n\n⚠️ *Falta para completar el alta:*\n- ${intakeResult.errors.join("\n- ")}`;
      guidanceMsg += `\n\n💬 _Envía los datos faltantes en tu próximo mensaje (o escribe #cancelar para anular)._`;

      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, guidanceMsg);
      }

      return { ok: false, incomplete: true, missing: intakeResult.errors };
    }

    // Otros errores
    return { ok: false, error: intakeResult.reason };
  } catch (err) {
    console.error("❌ Error en handleStaffIntakeInbound:", err.message);

    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(
        from,
        `⚠️ Error procesando datos: ${err.message}. Escribe #cancelar si deseas reiniciar.`
      );
    }

    return { ok: false, error: err.message };
  }
}
