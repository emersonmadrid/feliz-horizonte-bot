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
  sendWhatsAppMessage,
  sendWhatsAppButtons,
} from "./intake/integrations/whatsapp.js";
import {
  getConversationState,
  mergeConversationState,
  deleteConversationState,
} from "../../services/state.service.js";

const DRAFT_TTL_MS = 15 * 60 * 1000;

function buildHelpMenu() {
  return (
    `¿Qué deseas realizar?\n\n` +
    `1️⃣ 🧠 Historia Clínica\n` +
    `2️⃣ 📝 Actualizar Datos\n` +
    `3️⃣ 📋 Nuevo Paciente`
  );
}

function extractPatientTarget(text) {
  if (!text) return null;
  const clean = text
    .trim()
    .replace(/^(es de|para|del paciente|el paciente es|es para|de|paciente)\s+/i, "")
    .replace(/^#/, "")
    .trim();
  return clean || null;
}

async function replyText(to, text, config, overrideFn) {
  if (typeof overrideFn === "function") {
    return await overrideFn(to, text);
  }
  return await sendWhatsAppMessage({ to, text, config });
}

async function replyButtons(to, text, buttons, config, overrideFn) {
  if (typeof overrideFn === "function") {
    return await overrideFn(to, text, buttons);
  }
  return await sendWhatsAppButtons({ to, text, buttons, config });
}

async function handleClinicalHistoryDirect({
  from,
  target,
  historiaData,
  rawText,
  config,
  sendText,
  notifyTelegram,
  auditLogger,
  stateKey,
}) {
  try {
    if (!target) {
      if (stateKey) {
        await mergeConversationState(stateKey, {
          pendingClinical: {
            historiaData,
            rawText,
            updatedAt: Date.now(),
          },
        });
      }
      await sendText(from, "¿De qué paciente es esta sesión?");
      return { ok: false, reason: "missing_target", pendingTarget: true };
    }

    const result = await insertClinicalHistoryRow({
      target,
      historyData: historiaData,
      senderPhone: from,
      config,
    });

    if (!result.success) {
      if (result.reason === "multiple") {
        if (stateKey) {
          await mergeConversationState(stateKey, {
            pendingClinical: {
              historiaData,
              rawText,
              updatedAt: Date.now(),
            },
          });
        }
        const list = result.matches
          .map((m) => `• *#${m.id}* ${m.nombre}${m.dni ? ` (DNI: ${m.dni})` : ""}`)
          .join("\n");
        const msg =
          `Encontré varios pacientes con "${target}". ¿A cuál corresponde?\n\n` +
          `${list}\n\n` +
          `_Responde con el ID (ej: ${result.matches[0]?.id})._`;
        await sendText(from, msg);
        return { ok: false, reason: "multiple", pendingTarget: true };
      }

      if (result.reason === "not_found") {
        if (stateKey) {
          await mergeConversationState(stateKey, {
            pendingClinical: {
              historiaData,
              rawText,
              updatedAt: Date.now(),
            },
          });
        }
        const errorMsg = `⚠️ No encontré al paciente "${target}". ¿Cuál es su nombre o ID?`;
        await sendText(from, errorMsg);
        return { ok: false, reason: "not_found", pendingTarget: true };
      }

      if (result.reason === "archived") {
        const errorMsg = `⚠️ El paciente #${result.id} (${result.nombre}) está archivado.`;
        if (stateKey) await deleteConversationState(stateKey);
        await sendText(from, errorMsg);
        return { ok: false, reason: "archived" };
      }

      await sendText(from, `⚠️ No se pudo registrar la consulta: ${result.reason}`);
      return { ok: false, reason: result.reason };
    }

    if (stateKey) {
      await deleteConversationState(stateKey);
    }

    // Confirmación concisa y directa
    const responseText = result.isAppended
      ? `✅ Nota agregada a la sesión de hoy de *${result.patientName}*.`
      : `✅ Sesión de *${result.patientName}* guardada en Historia Clínica.`;
    await sendText(from, responseText);

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
    await sendText(from, `⚠️ Error guardando consulta: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function handlePatientUpdateDirect({
  from,
  target,
  updates,
  rawText,
  config,
  sendText,
  notifyTelegram,
  auditLogger,
  stateKey,
}) {
  try {
    if (!target) {
      if (stateKey) {
        await mergeConversationState(stateKey, {
          pendingUpdate: {
            updates,
            rawText,
            updatedAt: Date.now(),
          },
        });
      }
      await sendText(from, "¿De qué paciente deseas actualizar estos datos?");
      return { ok: false, reason: "missing_target", pendingTarget: true };
    }

    const updaterEmail = `whatsapp:${from}`;
    const updateResult = await updatePatientRow(target, updates, updaterEmail, config);

    if (!updateResult.success) {
      if (updateResult.reason === "multiple") {
        if (stateKey) {
          await mergeConversationState(stateKey, {
            pendingUpdate: {
              updates,
              rawText,
              updatedAt: Date.now(),
            },
          });
        }
        const list = updateResult.matches
          .map((m) => `• *#${m.id}* ${m.nombre}${m.dni ? ` (DNI: ${m.dni})` : ""}`)
          .join("\n");
        const msg =
          `Encontré varios pacientes con "${target}". ¿A cuál deseas actualizar?\n\n` +
          `${list}\n\n` +
          `_Responde con el ID (ej: ${updateResult.matches[0]?.id})._`;
        await sendText(from, msg);
        return { ok: false, reason: "multiple", pendingTarget: true };
      }

      if (updateResult.reason === "not_found") {
        if (stateKey) {
          await mergeConversationState(stateKey, {
            pendingUpdate: {
              updates,
              rawText,
              updatedAt: Date.now(),
            },
          });
        }
        const errorMsg = `⚠️ No encontré al paciente "${target}". ¿Cuál es su nombre o ID?`;
        await sendText(from, errorMsg);
        return { ok: false, reason: "not_found", pendingTarget: true };
      }

      if (updateResult.reason === "archived") {
        const errorMsg = `⚠️ El paciente #${updateResult.id} (${updateResult.nombre}) está archivado.`;
        if (stateKey) await deleteConversationState(stateKey);
        await sendText(from, errorMsg);
        return { ok: false, reason: "archived" };
      }

      await sendText(from, `⚠️ No se pudo actualizar el paciente: ${updateResult.reason}`);
      return { ok: false, reason: updateResult.reason };
    }

    if (stateKey) {
      await deleteConversationState(stateKey);
    }

    // Confirmación concisa y directa
    let responseText = `✅ Ficha de *${updateResult.fullName}* actualizada.`;
    if (updateResult.modifiedFields?.length > 0) {
      const summary = updateResult.modifiedFields.map((m) => `${m.label}: ${m.value}`).join(", ");
      responseText = `✅ Ficha de *${updateResult.fullName}* actualizada (${summary}).`;
    }

    await sendText(from, responseText);

    if (typeof notifyTelegram === "function") {
      await notifyTelegram(
        "📝 FICHA DE PACIENTE ACTUALIZADA",
        [
          `ID: #${updateResult.id}`,
          `Nombre: ${updateResult.fullName}`,
          ...updateResult.modifiedFields.map((m) => `${m.label}: ${m.value}`),
          `Actualizado por: WhatsApp ${from}`,
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
          modifiedFields: updateResult.modifiedFields,
        },
      });
    }

    return { ok: true, data: updateResult };
  } catch (err) {
    console.error("❌ Error en handlePatientUpdateDirect:", err.message);
    await sendText(from, `⚠️ Error al actualizar ficha: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export async function handleStaffIntakeInbound({
  from,
  text,
  buttonSelection = null,
  env = process.env,
  sendWhatsAppText = null,
  sendWhatsAppButtons: customSendButtons = null,
  notifyTelegram,
  auditLogger = null,
}) {
  console.log(`📋 [STAFF INTAKE] Mensaje de ${from}: "${text?.slice(0, 60)}" (button: ${buttonSelection || "none"})`);

  const config = loadConfig(env);
  const sendText = (to, msg) => replyText(to, msg, config, sendWhatsAppText);
  const sendButtons = (to, body, buttons) => replyButtons(to, body, buttons, config, customSendButtons);

  const stateKey = `staff_intake:${from}`;
  const cleanBody = (text || "").trim().toLowerCase();

  // 1. Manejo de botones táctiles
  if (
    buttonSelection === "btn_historia" ||
    cleanBody === "🧠 historia clínica" ||
    cleanBody === "historia clinica" ||
    cleanBody === "historia clínica"
  ) {
    await sendText(from, "Envía el nombre del paciente y las notas de la sesión.");
    return { ok: true, action: "button_prompt_historia" };
  }

  if (
    buttonSelection === "btn_actualizar" ||
    cleanBody === "📝 actualizar datos" ||
    cleanBody === "actualizar datos"
  ) {
    await sendText(from, "Indica el paciente y el dato a modificar.");
    return { ok: true, action: "button_prompt_actualizar" };
  }

  if (
    buttonSelection === "btn_alta" ||
    cleanBody === "📋 nuevo paciente" ||
    cleanBody === "nuevo paciente" ||
    cleanBody === "alta paciente"
  ) {
    await sendText(from, "Pega los datos del paciente o reenvía su contacto.");
    return { ok: true, action: "button_prompt_alta" };
  }

  // 2. Cancelación
  if (
    cleanBody === "#cancelar" ||
    cleanBody === "/cancelar" ||
    cleanBody === "#anular" ||
    cleanBody === "cancelar" ||
    cleanBody === "anular"
  ) {
    await deleteConversationState(stateKey);
    await sendText(from, "Operación cancelada.");
    return { ok: true, cancelled: true };
  }

  // 3. Menú de opciones (botones interactivos)
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

  const staffButtons = [
    { id: "btn_historia", title: "🧠 Historia Clínica" },
    { id: "btn_actualizar", title: "📝 Actualizar Datos" },
    { id: "btn_alta", title: "📋 Nuevo Paciente" },
  ];

  if (isHelpOrGreeting) {
    await sendButtons(from, "¿Qué deseas realizar?", staffButtons);
    return { ok: true, action: "help_menu" };
  }

  // 4. Revisar estado activo (borrador de alta o sesión/actualización pendiente de paciente)
  const now = Date.now();
  let existingState = null;
  try {
    existingState = await getConversationState(stateKey);
  } catch (err) {
    console.warn("⚠️ No se pudo consultar borrador en state service:", err.message);
  }

  // 4.1. Si había una sesión clínica dictada esperando el nombre del paciente:
  if (
    existingState?.pendingClinical &&
    now - (existingState.pendingClinical.updatedAt || 0) < DRAFT_TTL_MS &&
    !isHelpOrGreeting &&
    !cleanBody.startsWith("#") &&
    !buttonSelection
  ) {
    const candidateTarget = extractPatientTarget(text);
    if (candidateTarget) {
      console.log(`🔗 Asociando sesión previa al paciente: "${candidateTarget}"`);
      const { historiaData, rawText: originalText } = existingState.pendingClinical;
      return await handleClinicalHistoryDirect({
        from,
        target: candidateTarget,
        historiaData,
        rawText: `${originalText}\n(Paciente: ${candidateTarget})`,
        config,
        sendText,
        notifyTelegram,
        auditLogger,
        stateKey,
      });
    }
  }

  // 4.2. Si había una actualización pendiente esperando el nombre del paciente:
  if (
    existingState?.pendingUpdate &&
    now - (existingState.pendingUpdate.updatedAt || 0) < DRAFT_TTL_MS &&
    !isHelpOrGreeting &&
    !cleanBody.startsWith("#") &&
    !buttonSelection
  ) {
    const candidateTarget = extractPatientTarget(text);
    if (candidateTarget) {
      console.log(`🔗 Asociando actualización previa al paciente: "${candidateTarget}"`);
      const { updates, rawText: originalText } = existingState.pendingUpdate;
      return await handlePatientUpdateDirect({
        from,
        target: candidateTarget,
        updates,
        rawText: `${originalText}\n(Paciente: ${candidateTarget})`,
        config,
        sendText,
        notifyTelegram,
        auditLogger,
        stateKey,
      });
    }
  }

  // 4.3. Si había un borrador de alta acumulativa en curso
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
  }

  // 5. Clasificación inteligente con IA
  let classified = null;
  try {
    classified = await classifyAndParseStaffMessage(combinedText, config);
    console.log(`🧠 [INTELIGENCIA STAFF] Intención: ${classified.intent} | Target: ${classified.target || "N/A"}`);
  } catch (err) {
    console.warn("⚠️ Falló clasificación IA:", err.message);
  }

  // 6. Enrutamiento según intención

  // CASO A: HISTORIA CLÍNICA / CONSULTA
  if (classified?.intent === "HISTORIA_CLINICA" || isExplicitClinical) {
    const historiaData = classified?.historia || (await parseClinicalHistoryFromText(text, config));
    return await handleClinicalHistoryDirect({
      from,
      target: classified?.target || historiaData.target,
      historiaData,
      rawText: text,
      config,
      sendText,
      notifyTelegram,
      auditLogger,
      stateKey,
    });
  }

  // CASO B: ACTUALIZAR DATOS PERSONALES
  if (classified?.intent === "ACTUALIZAR_DATOS" || isExplicitUpdate) {
    const updates = classified?.actualizacion || (await parsePatientUpdateFromText(text, config));
    return await handlePatientUpdateDirect({
      from,
      target: classified?.target || updates.target,
      updates,
      rawText: text,
      config,
      sendText,
      notifyTelegram,
      auditLogger,
      stateKey,
    });
  }

  // CASO C: SALUDO / MENÚ DETECTADO POR IA
  if (classified?.intent === "AYUDA_O_SALUDO") {
    await sendButtons(from, "¿Qué deseas realizar?", staffButtons);
    return { ok: true, action: "help_menu" };
  }

  // CASO D: NUEVO PACIENTE (ALTA)
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
      await sendText(from, responseText);

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
      const p = intakeResult.patient || {};
      const recopilado = [];
      const fullName = `${p.nombre || ""} ${p.apellidos || ""}`.trim();
      if (fullName) recopilado.push(`• Nombre: *${fullName}*`);
      if (p.telefono) recopilado.push(`• Celular: *${p.telefono}*`);
      if (p.email) recopilado.push(`• Email: *${p.email}*`);

      if (recopilado.length === 0) {
        await sendButtons(from, "¿Qué deseas realizar?", staffButtons);
        return { ok: true, action: "help_menu" };
      }

      await mergeConversationState(stateKey, {
        intakeDraft: {
          text: combinedText,
          updatedAt: now,
          patient: intakeResult.patient,
        },
      });

      const guidanceMsg = `⚠️ *Faltan datos para completar el registro:*\n- ${intakeResult.errors.join("\n- ")}`;
      await sendText(from, guidanceMsg);
      return { ok: false, incomplete: true, missing: intakeResult.errors };
    }

    return { ok: false, error: intakeResult.reason };
  } catch (err) {
    console.error("❌ Error en handleStaffIntakeInbound:", err.message);
    await sendText(from, `⚠️ No pude procesar la solicitud. Escribe "menu" para ver opciones.`);
    return { ok: false, error: err.message };
  }
}
