// src/services/ai.service.js - VERSIÓN CORREGIDA CON HISTORIAL PERSISTENTE
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getPromptConfig } from "../prompts/prompt-loader.js";
import { buildPrompt, sanitizeGeminiApiKey } from "../utils/ai.utils.js";
import { mergeConversationState } from "./state.service.js";
import { findLearnedResponse, markResponseUsed } from "./learning.service.js";
import {
  saveMessage,
  getConversationHistory,
  formatHistoryForPrompt,
  getHistoryStats
} from "./conversation-history.service.js";
import calendarService from "./calendar.service.js";

const RAW_KEY = process.env.GEMINI_API_KEY || "";
const API_KEY = sanitizeGeminiApiKey(RAW_KEY);

if (!API_KEY || !API_KEY.startsWith("AIza")) {
  console.error("❌ GEMINI_API_KEY inválida o vacía. Revisa tu .env");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const multimodalModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const audioReplyModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    responseMimeType: "audio/mpeg",
  },
});

export async function generateAIReply({ text, conversationContext = null, phone = null }) {
  // 1. RECUPERAR HISTORIAL DESDE SUPABASE
  let contextPrompt = "";
  
  if (phone) {
    const history = await getConversationHistory(phone, 15);
    if (history.length > 0) {
      contextPrompt = formatHistoryForPrompt(history);
      // ... (código existente de estadísticas) ...
    }
  }

  // 2. BUSCAR RESPUESTA APRENDIDA (NUEVO)
  const learnedResponse = await findLearnedResponse(text);

  if (learnedResponse) {
    console.log(`🧠 Respuesta aprendida encontrada (ID: ${learnedResponse.id})`);
    console.log(`   Se usará como referencia para humanizar, no como copia directa`);

    // Incrementar contador de uso
    await markResponseUsed(learnedResponse.id);

    // AGREGAR CONTEXTO ESPECIAL para que la IA humanice
    contextPrompt += `

=== INFORMACIÓN VALIDADA POR HUMANO (FUENTE DE VERDAD) ===
`;
    contextPrompt += `Pregunta similar previa: "${learnedResponse.question_pattern}"

`;
    contextPrompt += `Respuesta que dio nuestro equipo humano:
"${learnedResponse.human_response}"

`;
    contextPrompt += `INSTRUCCIONES CRÍTICAS PARA TI:
`;
    contextPrompt += `- USA la información de arriba como base factual (nombres, teléfonos, datos exactos)
`;
    contextPrompt += `- MANTÉN todos los datos exactos sin cambiarlos
`;
    contextPrompt += `- ADAPTA el tono y estructura a la pregunta actual del cliente
`;
    contextPrompt += `- HAZ que tu respuesta suene natural, empática y NO robótica
`;
    contextPrompt += `- NO copies textualmente, reescribe con tus palabras manteniendo los datos
`;
    contextPrompt += `- AGREGA contexto personal si el cliente lo proporcionó (ej: "para mi hijo")
`;
    contextPrompt += `- Si es apropiado, HAZ una pregunta de seguimiento relevante
`;
    contextPrompt += `- Cada respuesta debe ser ÚNICA, aunque la info base sea la misma
`;
    contextPrompt += `==========================================================

`;

    // Marcar en el contexto que hay respuesta aprendida
    conversationContext = {
      ...conversationContext,
      hasLearnedReference: true,
      learnedResponseId: learnedResponse.id,
      learnedCategory: learnedResponse.category
    };

    // NO hacer return aquí, continuar con generación normal de IA
  }

  // --- NUEVO CÓDIGO INICIO: Inyectar disponibilidad en el contexto ---
  const availabilityKeywords = /\b(horarios?|horas?|libre|disponible|cu[aá]ndo|agenda|turno|hueco|hoy|mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|tarde|noche|d[ií]as?|fechas?)\b/i;
  
  if (availabilityKeywords.test(text)) {
    console.log(`📅 Usuario pregunta por horarios. Consultando Calendar...`);
    try {
      // Obtenemos los horarios crudos
      const scheduleText = await calendarService.getNextAvailability();
      
      if (scheduleText) {
        // Se lo damos a la IA para que ella filtre según lo que pida el usuario
        contextPrompt += `\n\n=== INFORMACIÓN DE AGENDA EN TIEMPO REAL (FUENTE DE VERDAD) ===\n${scheduleText}\nINSTRUCCIONES: Usa esta lista para responder. Si el usuario pide un día específico (ej. "solo lunes"), MUESTRA SOLO ESE DÍA. No inventes horarios.\n==========================================================\n`;
      } else {
        contextPrompt += `\n\n=== INFORMACIÓN DE AGENDA ===\nLa agenda está llena o no disponible por el momento.\n=============================\n`;
      }
    } catch (err) {
      console.error("⚠️ Error consultando Calendar para contexto:", err.message);
    }
  }  
  // 2. AÑADIR CONTEXTO DEL ESTADO
  if (conversationContext) {
    contextPrompt += `\nCONTEXTO ADICIONAL:\n`;
    if (conversationContext.isHumanHandling) {
      contextPrompt += `- ⚠️ Un humano acaba de manejar esta conversación\n`;
    }
    if (conversationContext.awaitingScheduling) {
      contextPrompt += `- 📅 El cliente estaba en proceso de agendamiento\n`;
    }
    if (conversationContext.lastIntent) {
      contextPrompt += `- 🎯 Última intención detectada: ${conversationContext.lastIntent}\n`;
    }
    if (conversationContext.servicePreference) {
      const labels = {
        therapy_individual: 'terapia psicológica individual',
        therapy_couples: 'terapia de parejas',
        therapy_family: 'terapia familiar',
        psychiatry: 'consulta psiquiátrica'
      };
      const label = labels[conversationContext.servicePreference] || 'el servicio indicado';
      contextPrompt += `- ✅ El cliente indicó interés en ${label}\n`;
    }
  }

  // DETECCIÓN DE SERVICIOS NO OFRECIDOS
  const unavailableServiceKeywords = [
    /\b(autis[mt]|tea|espectro autista|asperger)\b/i,
    /\b(neuropsicolog[íi]a|evaluaci[óo]n neurol[óo]gica)\b/i,
    /\b(terapia ocupacional|ocupacional)\b/i,
    /\b(psicopedag[óo]gico|psicopedagog[íi]a|dislexia|tdah)\b/i,
    /\b(terapia aba|aba therapy|intervenci[óo]n temprana)\b/i,
    /\b(ni[ñn]o autista|beb[eé] autista|hijo autista)\b/i,
    /\b(terapia infantil|ni[ñn]os peque[ñn]os|beb[eée]s)\b/i
  ];

  const isUnavailableService = unavailableServiceKeywords.some(regex => regex.test(text));

  if (isUnavailableService) {
    console.log(`⚠️ Servicio no disponible detectado: ${phone}`);

    const unavailableMessage =
      "Actualmente no contamos con ese servicio especializado. " +
      "Sin embargo, déjame conectarte con el equipo para que puedan " +
      "orientarte sobre profesionales especializados que puedan ayudarte. 💙";

    // Guardar en historial
    if (phone) {
      await saveMessage({
        phone,
        role: 'user',
        content: text,
        intent: 'servicio_no_disponible',
        service: null
      });

      await saveMessage({
        phone,
        role: 'assistant',
        content: unavailableMessage,
        intent: 'servicio_no_disponible',
        service: null
      });
    }

    return {
      message: unavailableMessage,
      meta: {
        intent: "servicio_no_disponible",
        priority: "high",
        notify_human: true,
        service: null,
        suggested_actions: ["transfer_to_specialist"],
        confidence: 0.95
      }
    };
  }

  try {
    // 3. GENERAR RESPUESTA CON CONTEXTO COMPLETO
    const { prompt: businessPrompt, versionTag, source } = await getPromptConfig();
    const input = buildPrompt({ businessPrompt, contextPrompt, text });

    console.log(`🧠 Generando respuesta (prompt v=${versionTag}, source=${source}) para ${phone || 'desconocido'}`);

    const result = await model.generateContent({
      contents: [{ parts: [{ text: input }] }],
    });
    
    let out = result.response.text().trim();
    out = out.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const lines = out.split("\n");
    let rawJson = lines[lines.length - 1];
    
    let jsonFound = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("{") && lines[i].includes('"intent"')) {
        rawJson = lines[i].trim();
        lines.splice(i, 1);
        jsonFound = true;
        break;
      }
    }
    
    let message = lines.join("\n").trim();

    let meta = {
      intent: "info",
      priority: "low",
      notify_human: false,
      service: null,
      suggested_actions: [],
      confidence: 0.6,
    };
    
    try {
      const cleanJson = rawJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      meta = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("❌ Error parseando JSON de IA:", parseError.message);
      try {
        const intentMatch = rawJson.match(/"intent"\s*:\s*"([^"]+)"/);
        const priorityMatch = rawJson.match(/"priority"\s*:\s*"([^"]+)"/);
        const notifyMatch = rawJson.match(/"notify_human"\s*:\s*(true|false)/);
        const serviceMatch = rawJson.match(/"service"\s*:\s*"([^"]+)"/);
        
        if (intentMatch) meta.intent = intentMatch[1];
        if (priorityMatch) meta.priority = priorityMatch[1];
        if (notifyMatch) meta.notify_human = notifyMatch[1] === 'true';
        if (serviceMatch) meta.service = serviceMatch[1] === 'null' ? null : serviceMatch[1];
      } catch (e) {
        console.error("❌ Error en extracción manual de meta:", e.message);
      }
    }

    // CORRECCIÓN: Fallback de mensaje si está vacío
    const MIN_MESSAGE_LENGTH = 4;
    if (!message || message.length < MIN_MESSAGE_LENGTH) {
      console.warn(`⚠️ Mensaje de IA vacío o muy corto. Generando fallback conversacional.`);
      
      switch (meta.intent) {
        case 'agendar':
          message = "¡Perfecto! Un momento por favor, te envío la información para agendar tu cita. 😊";
          break;
        case 'precios':
        case 'servicios':
          message = "Claro, con gusto te doy la información. ¿Cuál de nuestros servicios te interesa? 💙";
          break;
        case 'horarios':
          message = "Nuestros horarios son L-V 9AM-8PM y Sáb 9AM-2PM. ¿Te gustaría agendar una cita? ✨";
          break;
        case 'despedida':
          message = "Gracias por contactarnos. ¡Que tengas un excelente día! 😊";
          break;
        default:
          message = "Hola, soy el asistente de Feliz Horizonte. ¿En qué puedo ayudarte hoy? 😊";
          break;
      }
      
      if (meta.intent === 'saludo' || meta.intent === 'despedida' || meta.intent === 'error') {
        meta.intent = 'info';
        meta.confidence = 0.5;
      }
    }
    
    const normalizedText = text.toLowerCase();

    // Detección manual de servicio si la IA falló
    if (!meta.service || meta.service === 'null') {
      if (/\b(terapia individual|ansiedad|depresi[óo]n|estr[eé]s)\b/i.test(normalizedText)) {
        meta.service = 'therapy_individual';
        console.log(`🔧 Detección manual: servicio = therapy_individual`);
      } else if (/(terapia de pareja|pareja|relaci[óo]n)/i.test(normalizedText)) {
        meta.service = 'therapy_couples';
        console.log(`🔧 Detección manual: servicio = therapy_couples`);
      } else if (/(terapia familiar|familia)/i.test(normalizedText)) {
        meta.service = 'therapy_family';
        console.log(`🔧 Detección manual: servicio = therapy_family`);
      } else if (/(psiquiatr[íi]a|psiquiatra|medicaci[óo]n)/i.test(normalizedText)) {
        meta.service = 'psychiatry';
        console.log(`🔧 Detección manual: servicio = psychiatry`);
      }
    }

    if (conversationContext?.servicePreference && (!meta.service || meta.service === 'null')) {
      meta.service = conversationContext.servicePreference;
      console.log(`🔧 Override: servicio definido por botones = ${meta.service}`);
    }

    let finalMessage = message;

    // Confirmaciones basadas en contexto previo
    if (conversationContext?.awaitingPriceConfirmation && /\b(s[ií]|si|sí|claro|ok|vale|me parece|de acuerdo)\b/i.test(normalizedText)) {
      await mergeConversationState(phone, {
        priceConfirmed: true,
        awaitingPriceConfirmation: false
      });
      conversationContext.priceConfirmed = true;
      conversationContext.awaitingPriceConfirmation = false;
    }

    if (conversationContext?.awaitingPaymentConfirmation && /\b(s[ií]|si|sí|claro|ok|vale|de acuerdo|listo)\b/i.test(normalizedText)) {
      await mergeConversationState(phone, {
        awaitingPaymentConfirmation: false
      });
      conversationContext.awaitingPaymentConfirmation = false;
    }

    // Manejo especial para solicitud de datos de pago
    if (meta?.intent === 'solicitar_datos_pago') {
      console.log(`💰 Cliente solicita datos de pago: ${phone}`);
      
      // Si ya confirmó el precio o está esperando pago, derivar a humano
      if (conversationContext?.priceConfirmed ||
          conversationContext?.awaitingPaymentConfirmation ||
          conversationContext?.paymentProcessExplained) {
        meta.notify_human = true;
        meta.priority = 'high';
        finalMessage = "👤 Perfecto, déjame conectarte con el equipo para que te envíen los datos de pago y confirmar tu cita. Un momento por favor. 💙";

        // Actualizar estado para indicar que están esperando datos
        await mergeConversationState(phone, {
          awaitingPaymentData: true,
          isHumanHandling: true
        });
      } else {
        // Si NO confirmó precio, recordarle primero
        const serviceType = conversationContext?.pendingService || meta?.service || 'therapy_individual';
        let price = 85;
        let serviceName = "terapia individual";

        if (serviceType === 'therapy_couples') {
          price = 100;
          serviceName = "terapia de parejas";
        } else if (serviceType === 'therapy_family') {
          price = 100;
          serviceName = "terapia familiar";
        } else if (serviceType === 'psychiatry') {
          price = 139;
          serviceName = "consulta psiquiátrica";
        }

        const shortOrInsistent = text.length <= 20 || /\b(link|pago|pagar|datos|dame|manda|envi[aá]me)\b/i.test(text);
        const repeatedPaymentFlow = conversationContext?.awaitingPriceConfirmation || conversationContext?.awaitingPaymentData;

        if (shortOrInsistent && repeatedPaymentFlow) {
          meta.notify_human = true;
          meta.priority = 'high';
          // Dejar que el mensaje de la IA fluya sin repetir la confirmación
        } else {
          const reminder = `Para enviarte los datos de pago, primero necesito confirmar: ¿Te parece bien el costo de S/ ${price} para ${serviceName}? Una vez confirmes, te conectaré con el equipo. 😊`;
          if (!finalMessage || finalMessage.trim().length === 0) {
            finalMessage = reminder;
          } else if (!finalMessage.includes(reminder)) {
            finalMessage += `\n\n${reminder}`;
          }
          meta.notify_human = false;

          await mergeConversationState(phone, {
            awaitingPriceConfirmation: true,
            pendingService: serviceType,
            pendingPrice: price
          });
        }
      }
    }

    // Manejo de preguntas repetidas sobre servicios (dinámico)
    if ((meta?.intent === 'servicios' || meta?.intent === 'precios') && !meta.notify_human) {
      // Detectar servicio mencionado de forma flexible
      const textLower = text.toLowerCase();

      if (/pareja|parejas|relaci[oó]n|mi pareja/.test(textLower)) {
        meta.service = 'therapy_couples';
      } else if (/familia|familiar|padres|hijos/.test(textLower)) {
        meta.service = 'therapy_family';
      } else if (/psiquiatr|psiquiatra|medicaci[oó]n|medicamento/.test(textLower)) {
        meta.service = 'psychiatry';
      } else if (/individual|personal|yo|m[ií]/.test(textLower)) {
        meta.service = 'therapy_individual';
      }

      // Asegurar que NO se derive por preguntar de nuevo
      meta.notify_human = false;
      meta.priority = 'low';

      console.log(`🔄 Pregunta sobre servicio ${meta.service || 'general'} - respondiendo directamente`);
    }

    // 📅 DETECCIÓN DE HORARIOS CON FALLBACK
//    const availabilityKeywords = /\b(horarios?|horas?|libre|disponible|cu[aá]ndo|agenda|turno|hueco|hoy|mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|tarde|noche|d[ií]as?|fechas?)\b/i;
    
// 📅 DETECCIÓN DE HORARIOS - MEJORADO
// Insertar DESPUÉS de la línea 264 (después de los workflows de agendamiento)

// 📅 DETECCIÓN Y CONSULTA DE HORARIOS CON FILTRO POR DÍA
// Reemplazar la sección existente en ai.service.js

/* const availabilityKeywords = /\b(horarios?|horas?|libre|disponible|disponibilidad|cu[aá]ndo|agenda|turno|hueco|hoy|mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|tarde|noche|d[ií]as?|fechas?|dame|damelo|nuevamente|otra vez|de nuevo|solo|solamente|[uú]nicamente)\b/i;

if (availabilityKeywords.test(text)) {
  console.log("📅 Usuario pregunta por horarios. Consultando Calendar...");
  
  // Detectar si pide un día específico
  let specificDay = null;
  const dayPattern = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;
  const dayMatch = text.match(dayPattern);
  
  if (dayMatch) {
    specificDay = dayMatch[1].toLowerCase();
    // Normalizar acentos
    if (specificDay === 'miércoles') specificDay = 'miercoles';
    if (specificDay === 'sábado') specificDay = 'sabado';
    console.log(`🎯 Día específico solicitado: ${specificDay}`);
  }
  
  // Detectar filtros como "solo lunes", "únicamente martes"
  const filterPattern = /\b(solo|solamente|[uú]nicamente)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;
  const filterMatch = text.match(filterPattern);
  
  if (filterMatch) {
    specificDay = filterMatch[2].toLowerCase();
    if (specificDay === 'miércoles') specificDay = 'miercoles';
    if (specificDay === 'sábado') specificDay = 'sabado';
    console.log(`🔍 Filtro detectado: solo ${specificDay}`);
  }
  
  try {
    // Consultar calendario con filtro de día si aplica
    const scheduleText = await calendarService.getNextAvailability(7, specificDay);
    
    if (scheduleText && scheduleText.length > 50) {
      const isGenericSchedule = scheduleText.includes("Horarios de atención generales");
      
      if (isGenericSchedule) {
        // Horarios genéricos → Derivar a humano
        finalMessage = scheduleText + "\n\n👤 Un miembro de nuestro equipo te confirmará la disponibilidad exacta para que puedas elegir el mejor horario.";
        meta.intent = 'horarios';
        meta.notify_human = true;
        meta.priority = 'high';
        
        console.log("⚠️ Horarios genéricos mostrados, derivando a humano");
      } else {
        // Horarios reales disponibles
        if (specificDay) {
          finalMessage = `Aquí están los horarios disponibles para ${specificDay}:\n\n${scheduleText}\n\n¿Te gustaría reservar alguno de estos turnos? 😊`;
        } else {
          finalMessage = scheduleText + "\n\n¿Te gustaría reservar alguno de estos turnos? 😊";
        }
        
        meta.intent = 'horarios';
        meta.notify_human = false;
        meta.priority = 'low';
        
        // Guardar en contexto
        await mergeConversationState(phone, {
          lastScheduleShown: scheduleText,
          lastScheduleTime: Date.now(),
          lastDayFilter: specificDay
        });
        
        console.log("✅ Horarios reales mostrados al cliente");
      }
    } else {
      throw new Error("Respuesta inválida del calendario");
    }
    
  } catch (err) {
    console.error("⚠️ Error consultando Calendar:", err.message);
    
    const isUrgent = /\b(hoy|ahora|ahorita|ya|urgente)\b/i.test(text);
    
    if (isUrgent) {
      finalMessage = "Entiendo que necesitas una cita para hoy. 👤 Un miembro de nuestro equipo te contactará de inmediato para coordinar la disponibilidad.";
      meta.priority = 'high';
    } else {
      finalMessage = "Estoy consultando la disponibilidad actualizada. 👤 En un momento te confirmo los horarios disponibles para que puedas elegir el que mejor te convenga.";
      meta.priority = 'high';
    }
    
    meta.intent = 'horarios';
    meta.notify_human = true;
  }
}
    if (availabilityKeywords.test(text)) {
      console.log("📅 INTENTO DE CALENDARIO DETECTADO: " + text);
      console.log(`📅 Usuario pregunta por horarios. Consultando Calendar...`);
      
      try {
        // Intenta obtener horarios reales
        const scheduleText = await calendarService.getNextAvailability();
        
        if (scheduleText) {
          // ✅ ÉXITO: Muestra horarios automáticos
          finalMessage = scheduleText + "\n\n¿Te gustaría reservar alguno de estos turnos? 😊";
          meta.intent = 'info_calendar';
          meta.notify_human = false;
        } else {
          // Si devuelve vacío (agenda llena), lanza error para activar el catch
          throw new Error("Agenda llena o sin cupos");
        }
        
      } catch (err) {
        // ❌ FALLO / ERROR DE API: Fallback a humano
        console.error("⚠️ Error consultando Calendar:", err.message);
        finalMessage = "En este momento estoy actualizando mi agenda, pero no te preocupes. 👤 Un miembro de nuestro equipo te escribirá en breve para indicarte los horarios disponibles y ayudarte a coordinar.";
        meta.intent = 'check_availability_fallback';
        meta.notify_human = true; // <--- Importante: Llama al humano
        meta.priority = 'high';
      }
    }
 */
    // Workflow de agendamiento sin envío de links
    if (meta?.intent === 'agendar') {
      const state = conversationContext || {};
      const serviceType = meta?.service;

      // Determinar precio según servicio
      let price = 85;
      let serviceName = "terapia individual";

      if (serviceType === 'therapy_couples') {
        price = 100;
        serviceName = "terapia de parejas";
      } else if (serviceType === 'therapy_family') {
        price = 100;
        serviceName = "terapia familiar";
      } else if (serviceType === 'psychiatry') {
        price = 139;
        serviceName = "consulta psiquiátrica";
      }

      // PASO 1: Confirmar precio
      if (!state.priceConfirmed) {
        finalMessage += `\n\n💰 El costo de ${serviceName} es S/ ${price} por sesión de 50 min. ¿Te parece bien?`;
        await mergeConversationState(phone, {
          awaitingPriceConfirmation: true,
          pendingService: serviceType,
          pendingPrice: price,
          priceConfirmed: false,
          paymentProcessExplained: false,
          awaitingPaymentConfirmation: false
        });
        meta.notify_human = false;
      }
      // PASO 2: Explicar proceso de pago
      else if (!state.paymentProcessExplained) {
        finalMessage += `\n\n📋 Para confirmar tu cita necesitas:`;
        finalMessage += `\n1️⃣ Realizar el pago de S/ ${price}`;
        finalMessage += `\n2️⃣ Enviar captura del comprobante`;
        finalMessage += `\n3️⃣ Recibirás el link de tu sesión confirmada`;
        finalMessage += `\n\n¿Listo para continuar?`;
        await mergeConversationState(phone, {
          awaitingPaymentConfirmation: true,
          paymentProcessExplained: true
        });
        meta.notify_human = false;
      }
      // PASO 3: Derivar a humano
      else {
        meta.notify_human = true;
        meta.priority = 'high';
      }
    }

    
    // Si el cliente menciona "hoy" o "ahora", derivar a humano
    if (/\b(hoy|ahora|ahorita|ya|inmediato)\b/i.test(text) &&
        (meta.intent === 'agendar' || meta.intent === 'horarios')) {
      meta.notify_human = true;
      console.log(`⚠️ Solicitud urgente detectada: "${text}"`);
    }

    // 4. GUARDAR EN HISTORIAL PERSISTENTE
    if (phone) {
      await saveMessage({
        phone,
        role: 'user',
        content: text,
        intent: null,
        service: meta.service
      });

      await saveMessage({
        phone,
        role: 'assistant',
        content: message,
        intent: meta.intent,
        service: meta.service
      });
    }

    console.log(`📊 Meta final:`, JSON.stringify(meta));

    return {
      message: finalMessage,
      meta: {
        intent: meta?.intent || "info",
        priority: meta?.priority || "low",
        notify_human: meta?.notify_human || false,
        service: meta?.service || null,
        suggested_actions: meta?.suggested_actions || [],
        confidence: conversationContext?.hasLearnedReference ? 0.95 : (meta?.confidence || 0.6),
        based_on_learned_response: conversationContext?.hasLearnedReference || false,
        learned_response_id: conversationContext?.learnedResponseId || null
      }
    };
  } catch (e) {
    console.error("❌ AI error:", e?.message);
    return {
      message:
        "Gracias por escribirnos 😊 En este momento estoy teniendo dificultades técnicas. Un miembro de mi equipo te atenderá en breve.",
      meta: {
        intent: "error",
        priority: "high",
        notify_human: true,
        service: null,
        suggested_actions: [],
        confidence: 0.1,
      },
    };
  }
}

export async function transcribeAudioBuffer({ buffer, mimeType = "audio/ogg", prompt = null }) {
  if (!buffer || !buffer.length) {
    throw new Error("Audio buffer vacío");
  }

  const instruction =
    prompt ||
    "Transcribe con precisión este audio, conserva la puntuación natural y no agregues comentarios adicionales.";

  try {
    const response = await multimodalModel.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: instruction },
            {
              inlineData: {
                data: buffer.toString("base64"),
                mimeType,
              },
            },
          ],
        },
      ],
    });

    const transcription = response?.response?.text?.() || response?.response?.text || "";
    return (typeof transcription === "function" ? transcription() : transcription)?.trim() || "";
  } catch (err) {
    console.error("❌ Error transcribiendo audio:", err?.message);
    throw err;
  }
}

export async function synthesizeAudioFromText(text, { promptPrefix = null } = {}) {
  const cleanText = (text || "").trim();
  if (!cleanText) {
    throw new Error("Texto vacío para sintetizar audio");
  }

  const prompt =
    promptPrefix ||
    "Convierte el texto a un mensaje de voz claro, cálido y profesional en español peruano.";

  try {
    const response = await audioReplyModel.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: `${prompt}\n\nTexto:\n${cleanText}` }],
        },
      ],
    });

    const audioPart = response?.response?.candidates
      ?.flatMap((candidate) => candidate?.content?.parts || [])
      ?.find((part) => part.inlineData?.data);

    if (!audioPart?.inlineData?.data) {
      throw new Error("La IA no devolvió audio");
    }

    return {
      buffer: Buffer.from(audioPart.inlineData.data, "base64"),
      mimeType: audioPart.inlineData.mimeType || "audio/mpeg",
    };
  } catch (err) {
    console.error("❌ Error generando audio:", err?.message);
    throw err;
  }
}