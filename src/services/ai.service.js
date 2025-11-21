// src/services/ai.service.js - VERSIÓN CORREGIDA CON HISTORIAL PERSISTENTE
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getPromptConfig } from "../prompts/prompt-loader.js";
import { buildPrompt, sanitizeGeminiApiKey } from "../utils/ai.utils.js";
import {
  saveMessage,
  getConversationHistory,
  formatHistoryForPrompt,
  getHistoryStats
} from "./conversation-history.service.js";

const RAW_KEY = process.env.GEMINI_API_KEY || "";
const API_KEY = sanitizeGeminiApiKey(RAW_KEY);

if (!API_KEY || !API_KEY.startsWith("AIza")) {
  console.error("❌ GEMINI_API_KEY inválida o vacía. Revisa tu .env");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
    const history = await getConversationHistory(phone, 15); // Últimos 15 mensajes
    
    if (history.length > 0) {
      contextPrompt = formatHistoryForPrompt(history);
      
      // Añadir estadísticas de la conversación
      const stats = await getHistoryStats(phone);
      if (stats) {
        contextPrompt += `\nESTADÍSTICAS:\n`;
        contextPrompt += `- Mensajes totales: ${stats.totalMessages}\n`;
        contextPrompt += `- Edad de conversación: ${stats.conversationAge} minutos\n`;
        if (stats.lastIntent) {
          contextPrompt += `- Última intención: ${stats.lastIntent}\n`;
        }
      }
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
      const label = conversationContext.servicePreference === 'therapy'
        ? 'terapia psicológica'
        : 'consulta psiquiátrica';
      contextPrompt += `- ✅ El cliente indicó interés en ${label}\n`;
    }
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
    
    // Detección manual de servicio si la IA falló
    if (!meta.service || meta.service === 'null') {
      const textLower = text.toLowerCase();
      if (/(psicolog[íi]a|psic[óo]log[oa]|terapia|terapeuta)/i.test(textLower)) {
        meta.service = 'therapy';
        console.log(`🔧 Detección manual: servicio = therapy`);
      } else if (/(psiquiatr[íi]a|psiquiatra)/i.test(textLower)) {
        meta.service = 'psychiatry';
        console.log(`🔧 Detección manual: servicio = psychiatry`);
      }
    }

    if (conversationContext?.servicePreference && (!meta.service || meta.service === 'null')) {
      meta.service = conversationContext.servicePreference;
      console.log(`🔧 Override: servicio definido por botones = ${meta.service}`);
    }

    // Si detecta "agendar" + "therapy", NO derivar a humano
    if (meta.intent === 'agendar' && meta.service === 'therapy') {
      meta.notify_human = false;
      console.log(`🔧 Override: agendamiento de terapia = auto-respuesta`);
    }

    // Lógica de frustración
    const frustrationKeywords = [
      'ya te dije', 'ya dije', 'ya lo mencioné', 'repites', 'otra vez',
      'me ibas', 'ibas a', 'dijiste que', 'prometiste', 'cansado',
      'molesto', 'fastidioso', 'inútil'
    ];
    
    const textLower = text.toLowerCase();
    const isFrustrated = frustrationKeywords.some(keyword => textLower.includes(keyword));
    
    if (isFrustrated) {
      meta.notify_human = true;
      meta.priority = 'high';
      console.log(`⚠️ Frustración detectada en: "${text}"`);
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

    return { message, meta };
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