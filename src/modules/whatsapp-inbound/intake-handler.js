import { loadConfig } from "./intake/core/config.js";
import { processPatientIntake } from "./intake/services/intake-orchestrator.js";
import {
  parsePatientUpdateFromText,
  parseClinicalHistoryFromText,
} from "./intake/domain/parser.js";
import {
  updatePatientRow,
  insertClinicalHistoryRow,
} from "./intake/integrations/google-sheets.js";
import {
  getConversationState,
  mergeConversationState,
  deleteConversationState,
} from "../../services/state.service.js";

const DRAFT_TTL_MS = 15 * 60 * 1000; // 15 minutos para completar un registro por partes

async function handleClinicalHistoryFlow({
  from,
  text,
  config,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger,
}) {
  try {
    const parsed = await parseClinicalHistoryFromText(text, config);

    if (!parsed.target) {
      const errorMsg =
        "⚠️ *Falta el identificador del paciente para la Historia Clínica:*\n" +
        "Por favor indica el ID (ej: 188) o número de celular del paciente.\n\n" +
        "*Ejemplo:*\n" +
        "`#historia 188 Paciente acude refiriendo ansiedad por problemas familiares. Se aplica TREC y reestructuración cognitiva.`";
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: "missing_target" };
    }

    if (!parsed.motivo && !parsed.tratamiento && !parsed.observaciones) {
      const errorMsg =
        `⚠️ *No se detectaron notas clínicas para el paciente #${parsed.target}.*\n\n` +
        "*Ejemplo:*\n" +
        `\`#historia ${parsed.target} Paciente refiere insomnio y estrés laboral. Se aplica técnica de relajación progresiva.\``;
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: "no_clinical_notes" };
    }

    const result = await insertClinicalHistoryRow({
      target: parsed.target,
      historyData: parsed,
      senderPhone: from,
      config,
    });

    if (!result.success) {
      let errorMsg = `⚠️ No se pudo registrar la consulta: ${result.reason}`;
      if (result.reason === "not_found") {
        errorMsg =
          `⚠️ *No se encontró ningún paciente con el ID o celular:* \`${parsed.target}\`\n` +
          "Verifica el identificador en el sistema web.";
      } else if (result.reason === "archived") {
        errorMsg =
          `⚠️ *El paciente #${result.id} (${result.nombre}) está archivado.*\n` +
          "No se pueden registrar consultas en pacientes archivados.";
      }
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: result.reason };
    }

    // Éxito: confirmar por WhatsApp
    const lines = [
      `✅ *Consulta registrada en la Historia Clínica:*`,
      `• Paciente: *#${result.patientId} (${result.patientName})*`,
      `• Fecha: *${result.fecha}*`,
      `• Profesional: *${result.medico}*`,
    ];
    if (result.motivo) {
      lines.push(`• Motivo: *${result.motivo.slice(0, 120)}${result.motivo.length > 120 ? "..." : ""}*`);
    }
    if (result.tratamiento) {
      lines.push(`• Tratamiento: *${result.tratamiento.slice(0, 120)}${result.tratamiento.length > 120 ? "..." : ""}*`);
    }
    lines.push("");
    lines.push("🔗 *Ya visible en:* https://app.felizhorizonte.pe");

    const responseText = lines.join("\n");

    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, responseText);
    }

    if (typeof notifyTelegram === "function") {
      await notifyTelegram(
        "🧠 NUEVA CONSULTA / HISTORIA CLÍNICA",
        [
          `Paciente: #${result.patientId} ${result.patientName}`,
          `Especialista: ${result.medico}`,
          `Motivo: ${result.motivo || "No especificado"}`,
          `Tratamiento: ${result.tratamiento || "No especificado"}`,
          `Registrado por: WhatsApp ${from}`,
        ],
        from
      );
    }

    if (typeof auditLogger === "function") {
      await auditLogger({
        phone: from,
        messageText: text,
        messageType: "text",
        route: "staff_intake",
        action: "history_entry_created",
        status: "handled",
        metadata: {
          historyId: result.historyId,
          patientId: result.patientId,
        },
      });
    }

    return { ok: true, data: result };
  } catch (err) {
    console.error("❌ Error en handleClinicalHistoryFlow:", err.message);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, `⚠️ Error guardando consulta en Historia Clínica: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }
}

async function handlePatientUpdateFlow({
  from,
  text,
  config,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger,
}) {
  try {
    const cleanLower = text.toLowerCase();
    // Detección inteligente: Si es un relato clínico detallado enviado con #actualizar
    const isClinicalContent =
      cleanLower.includes("paciente refiere") ||
      cleanLower.includes("sesión") ||
      cleanLower.includes("sesion") ||
      cleanLower.includes("tratamiento") ||
      cleanLower.includes("terapia") ||
      cleanLower.includes("conductual");

    const hasDemographicKeywords =
      cleanLower.includes("dni") ||
      cleanLower.includes("correo") ||
      cleanLower.includes("email") ||
      cleanLower.includes("celular") ||
      cleanLower.includes("teléfono") ||
      cleanLower.includes("telefono") ||
      cleanLower.includes("dirección") ||
      cleanLower.includes("direccion") ||
      cleanLower.includes("trabajo");

    if (isClinicalContent && !hasDemographicKeywords) {
      console.log(`🧠 [INTELIGENCIA CLÍNICA] Redirigiendo reporte clínico a Historia Clínica de ${from}`);
      return await handleClinicalHistoryFlow({
        from,
        text,
        config,
        sendWhatsAppText,
        notifyTelegram,
        auditLogger,
      });
    }

    const parsed = await parsePatientUpdateFromText(text, config);

    if (!parsed.target) {
      const errorMsg =
        "⚠️ *Falta el identificador del paciente:*\n" +
        "Por favor indica el ID (ej: 192) o número de celular del paciente que deseas actualizar.\n\n" +
        "*Ejemplo:*\n" +
        "`#actualizar 192 DNI: 71234567, Ocupación: Contadora`\n" +
        "o\n" +
        "`#actualizar 955443322 vive en Miraflores`";
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: "missing_target" };
    }

    const hasAnyField =
      parsed.dni ||
      parsed.fechaNacimiento ||
      parsed.sexo ||
      parsed.telefono ||
      parsed.email ||
      parsed.direccion ||
      parsed.trabajo ||
      parsed.ocupacion ||
      parsed.estadocivil ||
      parsed.grado ||
      parsed.nombre ||
      parsed.apellidos ||
      parsed.observaciones;

    if (!hasAnyField) {
      const errorMsg =
        `⚠️ *No se detectaron datos nuevos para actualizar en el paciente #${parsed.target}.*\n\n` +
        "*Ejemplo:*\n" +
        `\`#actualizar ${parsed.target} DNI: 71234567, Ocupación: Contadora\``;
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: "no_fields_to_update" };
    }

    const updaterEmail = `whatsapp:${from}`;
    const updateResult = await updatePatientRow(parsed.target, parsed, updaterEmail, config);

    if (!updateResult.success) {
      let errorMsg = `⚠️ No se pudo actualizar el paciente: ${updateResult.reason}`;
      if (updateResult.reason === "not_found") {
        errorMsg =
          `⚠️ *No se encontró ningún paciente con el ID o celular:* \`${parsed.target}\`\n` +
          "Verifica que el número o ID sea correcto.";
      } else if (updateResult.reason === "archived") {
        errorMsg =
          `⚠️ *El paciente #${updateResult.id} (${updateResult.nombre}) está archivado.*\n` +
          "No se pueden modificar fichas archivadas desde WhatsApp.";
      }

      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: updateResult.reason };
    }

    // Éxito: formatear confirmación a WhatsApp
    const lines = [
      `✅ *Ficha del paciente #${updateResult.id} (${updateResult.fullName}) actualizada con éxito:*`
    ];
    for (const mod of updateResult.modifiedFields) {
      lines.push(`• ${mod.label}: *${mod.value}*`);
    }
    lines.push("");
    lines.push("🔗 Ficha: https://app.felizhorizonte.pe");

    const responseText = lines.join("\n");

    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, responseText);
    }

    if (typeof notifyTelegram === "function") {
      await notifyTelegram(
        "📝 FICHA DE PACIENTE ACTUALIZADA",
        [
          `ID: #${updateResult.id}`,
          `Nombre: ${updateResult.fullName}`,
          ...updateResult.modifiedFields.map((m) => `${m.label}: ${m.value}`),
          `Actualizado por: WhatsApp ${from}`
        ],
        from
      );
    }

    if (typeof auditLogger === "function") {
      await auditLogger({
        phone: from,
        messageText: text,
        messageType: "text",
        route: "staff_intake",
        action: "patient_updated",
        status: "handled",
        metadata: {
          patientId: updateResult.id,
          modifiedFields: updateResult.modifiedFields
        }
      });
    }

    return { ok: true, data: updateResult };
  } catch (err) {
    console.error("❌ Error en handlePatientUpdateFlow:", err.message);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, `⚠️ Error al actualizar ficha: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }
}

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

  // 2. Comando explícito de Historia Clínica / Consulta / Sesión
  const isClinicalCommand = /^(#|\/)?(historia|consulta|sesion|sesión|evolucion|evolución)\b/i.test(text.trim());
  if (isClinicalCommand) {
    return await handleClinicalHistoryFlow({
      from,
      text,
      config: loadConfig(env),
      sendWhatsAppText,
      notifyTelegram,
      auditLogger,
    });
  }

  // 3. Comando de actualización / modificación de ficha existente
  const isUpdateCommand = /^(#|\/)?(actualizar|modificar|agregar|update)\b/i.test(text.trim());
  if (isUpdateCommand) {
    return await handlePatientUpdateFlow({
      from,
      text,
      config: loadConfig(env),
      sendWhatsAppText,
      notifyTelegram,
      auditLogger,
    });
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
