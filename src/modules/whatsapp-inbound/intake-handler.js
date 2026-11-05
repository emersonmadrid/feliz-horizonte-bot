import { loadConfig } from "./intake/core/config.js";
import { processPatientIntake } from "./intake/services/intake-orchestrator.js";
import {
  parsePatientUpdateFromText,
  parseClinicalHistoryFromText,
  classifyAndParseStaffMessage,
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

const DRAFT_TTL_MS = 15 * 60 * 1000; // 15 minutos para borrador por partes

function buildHelpMenu(from) {
  const isDoctora = String(from).includes("922346747");
  const nombreStaff = isDoctora ? "Lic. Cintya" : "Emerson";
  return (
    `👋 ¡Hola, *${nombreStaff}*! Soy tu Asistente Clínico de *Feliz Horizonte*.\n\n` +
    `Puedes escribirme o dictarme audios con total libertad para gestionar el consultorio:\n\n` +
    `1️⃣ *Registrar Consulta / Sesión de Terapia:*\n` +
    `👉 _"Sesión de Kevin Vásquez: acude refiriendo impulsos voyeristas, se trabajó técnica de coste-beneficio y se envía libro de TREC"_\n\n` +
    `2️⃣ *Actualizar Datos de un Paciente:*\n` +
    `👉 _"El DNI de Valeria Mendoza es 71234567 y trabaja en BCP"_\n` +
    `👉 _"Kevin Vásquez ahora vive en Miraflores"_\n\n` +
    `3️⃣ *Nuevo Paciente (Alta):*\n` +
    `👉 _Reenvíame el mensaje del paciente o escribe su nombre, celular y correo._\n\n` +
    `💡 *Cero comandos:* Solo menciona el nombre o ID del paciente y yo me encargo de asociarlo y ordenarlo en la web.`
  );
}

async function handleClinicalHistoryDirect({
  from,
  target,
  historiaData,
  rawText,
  config,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger,
}) {
  try {
    if (!target) {
      const errorMsg =
        "⚠️ *Falta el nombre o identificador del paciente para registrar la consulta.*\n\n" +
        "*Ejemplo:*\n" +
        `_"Sesión de Kevin Vásquez: acude por ansiedad laboral, se aplicó relajación progresiva..."_`;
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: "missing_target" };
    }

    const result = await insertClinicalHistoryRow({
      target,
      historyData: historiaData,
      senderPhone: from,
      config,
    });

    if (!result.success) {
      let errorMsg = `⚠️ No se pudo registrar la consulta: ${result.reason}`;
      if (result.reason === "multiple") {
        errorMsg =
          `⚠️ *Encontré varios pacientes que coinciden con "${target}":*\n` +
          result.matches.map((m, i) => `${i + 1}) #${m.id}: *${m.nombre}*`).join("\n") +
          `\n\nPor favor indícame su nombre completo o ID (ej: "188").`;
      } else if (result.reason === "not_found") {
        errorMsg =
          `⚠️ *No se encontró ningún paciente con el nombre o ID:* \`${target}\`\n` +
          "Verifica el nombre en el sistema web.";
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

    // Confirmación formateada
    const lines = [
      `✅ *Consulta registrada en la Historia Clínica:*`,
      `• Paciente: *#${result.patientId} (${result.patientName})*`,
      `• Fecha: *${result.fecha}*`,
      `• Profesional: *${result.medico}*`,
    ];
    if (result.motivo) {
      lines.push(`• Motivo: *${result.motivo.slice(0, 110)}${result.motivo.length > 110 ? "..." : ""}*`);
    }
    if (result.tratamiento) {
      lines.push(`• Tratamiento: *${result.tratamiento.slice(0, 110)}${result.tratamiento.length > 110 ? "..." : ""}*`);
    }
    lines.push("");
    lines.push("🔗 *Ya visible en la web:* https://app.felizhorizonte.pe");

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
        messageText: rawText,
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
    console.error("❌ Error en handleClinicalHistoryDirect:", err.message);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, `⚠️ Error guardando consulta en Historia Clínica: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }
}

async function handlePatientUpdateDirect({
  from,
  target,
  updates,
  rawText,
  config,
  sendWhatsAppText,
  notifyTelegram,
  auditLogger,
}) {
  try {
    if (!target) {
      const errorMsg =
        "⚠️ *Falta el nombre o ID del paciente a actualizar.*\n\n" +
        "*Ejemplo:*\n" +
        `_"El DNI de Valeria Mendoza es 71234567 y trabaja en BCP"_`;
      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, errorMsg);
      }
      return { ok: false, reason: "missing_target" };
    }

    const updaterEmail = `whatsapp:${from}`;
    const updateResult = await updatePatientRow(target, updates, updaterEmail, config);

    if (!updateResult.success) {
      let errorMsg = `⚠️ No se pudo actualizar el paciente: ${updateResult.reason}`;
      if (updateResult.reason === "multiple") {
        errorMsg =
          `⚠️ *Encontré varios pacientes que coinciden con "${target}":*\n` +
          updateResult.matches.map((m, i) => `${i + 1}) #${m.id}: *${m.nombre}*`).join("\n") +
          `\n\nPor favor indícame su nombre completo o ID.`;
      } else if (updateResult.reason === "not_found") {
        errorMsg =
          `⚠️ *No se encontró ningún paciente con el nombre o ID:* \`${target}\`\n` +
          "Verifica el nombre o ID en el sistema web.";
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

    // Confirmación
    const lines = [
      `✅ *Ficha del paciente #${updateResult.id} (${updateResult.fullName}) actualizada:*`
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
        messageText: rawText,
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
    console.error("❌ Error en handlePatientUpdateDirect:", err.message);
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

  // 1. Comando de cancelación explícita
  if (
    cleanBody === "#cancelar" ||
    cleanBody === "/cancelar" ||
    cleanBody === "#anular" ||
    cleanBody === "cancelar" ||
    cleanBody === "anular"
  ) {
    await deleteConversationState(stateKey);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(
        from,
        "🗑️ *Operación cancelada.*\nSe ha descartado cualquier borrador pendiente. Puedes escribirme en cualquier momento para registrar pacientes o historias."
      );
    }
    return { ok: true, cancelled: true };
  }

  // 2. Saludo o solicitud de menú / ayuda
  const isHelpOrGreeting =
    cleanBody === "hola" ||
    cleanBody === "buenas" ||
    cleanBody === "buenos dias" ||
    cleanBody === "buenos días" ||
    cleanBody === "buenas tardes" ||
    cleanBody === "buenas noches" ||
    cleanBody === "menu" ||
    cleanBody === "menú" ||
    cleanBody === "ayuda" ||
    cleanBody === "help" ||
    cleanBody === "opciones" ||
    cleanBody === "¿que puedes hacer?" ||
    cleanBody === "que puedes hacer?";

  if (isHelpOrGreeting) {
    const helpMsg = buildHelpMenu(from);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, helpMsg);
    }
    return { ok: true, action: "help_menu" };
  }

  const config = loadConfig(env);

  // 3. Revisar si hay un borrador de alta incompleto en curso
  const now = Date.now();
  let existingState = null;
  try {
    existingState = await getConversationState(stateKey);
  } catch (err) {
    console.warn("⚠️ No se pudo consultar borrador en state service:", err.message);
  }

  const existingDraft = existingState?.intakeDraft;
  const isExplicitClinical = /^(#|\/)?(historia|consulta|sesion|sesión|evolucion|evolución)/i.test(text.trim());
  const isExplicitUpdate = /^(#|\/)?(actualizar|modificar|agregar|update)/i.test(text.trim());

  let combinedText = text;
  if (
    existingDraft?.text &&
    now - (existingDraft.updatedAt || 0) < DRAFT_TTL_MS &&
    !isExplicitClinical &&
    !isExplicitUpdate
  ) {
    combinedText = `${existingDraft.text}\n${text}`;
    console.log(`🧩 Combinando mensaje con borrador activo de ${from}`);
  }

  // 4. Clasificación inteligente con IA (Gemini Flash)
  let classified = null;
  try {
    classified = await classifyAndParseStaffMessage(combinedText, config);
    console.log(`🧠 [INTELIGENCIA STAFF] Intención detectada: ${classified.intent} | Target: ${classified.target || "N/A"}`);
  } catch (err) {
    console.warn("⚠️ Falló clasificación general, intentando flujos clásicos:", err.message);
  }

  // 5. Enrutamiento según intención:

  // CASO A: HISTORIA CLÍNICA / CONSULTA
  if (classified?.intent === "HISTORIA_CLINICA" || isExplicitClinical) {
    await deleteConversationState(stateKey); // Limpiar borradores previos
    const historiaData = classified?.historia || (await parseClinicalHistoryFromText(text, config));
    return await handleClinicalHistoryDirect({
      from,
      target: classified?.target || historiaData.target,
      historiaData,
      rawText: text,
      config,
      sendWhatsAppText,
      notifyTelegram,
      auditLogger,
    });
  }

  // CASO B: ACTUALIZAR DATOS PERSONALES
  if (classified?.intent === "ACTUALIZAR_DATOS" || isExplicitUpdate) {
    await deleteConversationState(stateKey);
    const updates = classified?.actualizacion || (await parsePatientUpdateFromText(text, config));
    return await handlePatientUpdateDirect({
      from,
      target: classified?.target || updates.target,
      updates,
      rawText: text,
      config,
      sendWhatsAppText,
      notifyTelegram,
      auditLogger,
    });
  }

  // CASO C: SALUDO O MENÚ DETECTADO POR IA
  if (classified?.intent === "AYUDA_O_SALUDO") {
    const helpMsg = buildHelpMenu(from);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(from, helpMsg);
    }
    return { ok: true, action: "help_menu" };
  }

  // CASO D: NUEVO PACIENTE (INTAKE / ALTA)
  try {
    const intakeResult = await processPatientIntake({
      text: combinedText,
      from: null,
      senderName: "Staff Feliz Horizonte",
      config,
    });

    if (intakeResult.success) {
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

    if (intakeResult.reason === "validation_failed") {
      // Si el texto era un mensaje suelto no clínico y no dio para alta, guiamos al usuario
      const p = intakeResult.patient || {};
      const recopilado = [];
      const fullName = `${p.nombre || ""} ${p.apellidos || ""}`.trim();
      if (fullName) recopilado.push(`• Nombre: *${fullName}*`);
      if (p.telefono) recopilado.push(`• Celular: *${p.telefono}*`);
      if (p.email) recopilado.push(`• Email: *${p.email}*`);

      // Si no capturó ni nombre ni celular ni correo, es probable que fuera un mensaje suelto
      if (recopilado.length === 0) {
        const helpMsg = buildHelpMenu(from);
        if (typeof sendWhatsAppText === "function") {
          await sendWhatsAppText(from, helpMsg);
        }
        return { ok: true, action: "help_menu" };
      }

      await mergeConversationState(stateKey, {
        intakeDraft: {
          text: combinedText,
          updatedAt: now,
          patient: intakeResult.patient,
        },
      });

      let guidanceMsg = `📝 *Anoté los siguientes datos del paciente:*`;
      guidanceMsg += `\n${recopilado.join("\n")}`;
      guidanceMsg += `\n\n⚠️ *Falta para completar el alta:*\n- ${intakeResult.errors.join("\n- ")}`;
      guidanceMsg += `\n\n💬 _Envía los datos faltantes en tu próximo mensaje (o escribe cancelar para anular)._`;

      if (typeof sendWhatsAppText === "function") {
        await sendWhatsAppText(from, guidanceMsg);
      }

      return { ok: false, incomplete: true, missing: intakeResult.errors };
    }

    return { ok: false, error: intakeResult.reason };
  } catch (err) {
    console.error("❌ Error en handleStaffIntakeInbound:", err.message);
    if (typeof sendWhatsAppText === "function") {
      await sendWhatsAppText(
        from,
        `⚠️ No pude interpretar la instrucción: ${err.message}. Escribe "menu" para ver opciones.`
      );
    }
    return { ok: false, error: err.message };
  }
}
