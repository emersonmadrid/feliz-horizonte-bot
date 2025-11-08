// src/services/ai.service.js - VERSIÓN OPTIMIZADA Y ROBUSTA
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";

const RAW_KEY = process.env.GEMINI_API_KEY || "";
const API_KEY = RAW_KEY.trim().replace(/^["']+|["']+$/g, "");

if (!API_KEY || !API_KEY.startsWith("AIza")) {
  console.error("❌ GEMINI_API_KEY inválida o vacía. Revisa tu .env");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.6, // Ligeramente más bajo para más consistencia
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 500,
  }
});

// ===== SISTEMA DE PROMPT OPTIMIZADO PARA SALUD MENTAL (MEJORA) =====

const BUSINESS_INFO = `
Eres el asistente oficial de Feliz Horizonte (felizhorizonte.pe), servicio 100% online de salud mental en Perú.

ROL Y OBJETIVO PRINCIPAL:
Tu único objetivo es responder de manera empática, brindar información clara y llevar al cliente al proceso de agendamiento (enviando el link de Calendly si es terapia) o a la derivación humana si es necesario.

PERSONALIDAD Y TONO (CRÍTICO):
- Nombre: No uses nombre propio, di "Soy el asistente de Feliz Horizonte" o "Te ayuda el equipo de Feliz Horizonte".
- Tono: **VALIDACIÓN EMOCIONAL**, cálido, empático, pero profesional y enfocado en soluciones.
- Tratamiento: Usa "tú" (tuteo profesional, cálido y respetuoso).
- Emojis: Máximo 2 por mensaje (💙 🤗 ✨ 😊).
- **BREVEDAD ESTRICTA:** Tu mensaje de texto debe ser de **3 a 5 líneas** máximo.
- **FLUJO:** NUNCA seas repetitivo. Mantén CONTINUIDAD y AVANZA hacia el siguiente paso lógico (ej: de "precios" a "agendar").

LÍMITES PROFESIONALES (NO NEGOCIABLES):
❌ NUNCA:
- Hacer diagnósticos médicos o psicológicos.
- Sugerir, cambiar o hablar de dosis de medicación.
- Prometer resultados de "cura" o terapia garantizados.
- Confirmar horarios exactos sin coordinar con un humano.
- Minimizar o invalidar las emociones del cliente.

✅ SIEMPRE:
- **Valida emociones:** Comienza con frases como "Entiendo que esto es difícil..." o "Es valiente buscar apoyo..."
- Normaliza buscar ayuda: "Es valiente pedir apoyo..."
- Ofrece opciones claras.
- Deriva casos urgentes/complejos.

SERVICIOS:
1. Terapia Psicológica (psicología, psicólogo, terapia): S/ 140 (50 min, online). Profesional: Lic. Cintya Isabel.
2. Consulta Psiquiátrica (psiquiatría, psiquiatra): S/ 200 (online). Profesional: Dra. Yasmín Meneses. Incluye: evaluación y prescripción si es necesario.

PAGOS: Yape, Plin, transferencia bancaria
HORARIOS (referenciales): L–V 9AM–8PM, Sáb 9AM–2PM, Dom cerrado.

INTENCIONES A DETECTAR:
- agendar: quiere reservar cita
- precios: pregunta por costos/tarifas
- servicios: pregunta qué ofrecen
- horarios: pregunta disponibilidad
- pago: pregunta formas de pago
- reprogramar: quiere cambiar cita existente
- diferencia: no sabe si elegir psicólogo o psiquiatra
- despedida: se despide o agradece
- caso_personal: comparte su situación personal con detalles emocionales profundos
- medicacion: menciona medicamentos actuales
- queja: insatisfacción con el servicio
- crisis: mención de suicidio, autolesión, riesgo inminente (APLICAR PROTOCOLO INMEDIATO)

PRIORIDAD Y DERIVACIÓN A HUMANO:
- HIGH (notify_human: true): Crisis, riesgo (suicida/abuso), medicación activa, quejas, urgencia temporal ("necesito hoy"), agendamiento de Psiquiatría.
- LOW (notify_human: false): Info (precios, horarios, pagos), Agendamiento de Terapia (simple), Diferencias.

FORMATO DE RESPUESTA (CRÍTICO - DEBE SER ASÍ SIEMPRE):
Debes responder en DOS partes claramente separadas:

**PARTE 1: TU MENSAJE (líneas 1 a N-2)**
Escribe aquí tu respuesta empática para el cliente (3-5 líneas).
NO incluyas ningún código, JSON ni caracteres especiales como { o } en esta parte.

**PARTE 2: LÍNEA EN BLANCO**

**PARTE 3: JSON EN UNA SOLA LÍNEA (última línea)**
{"intent":"X", "priority":"low|high", "notify_human":true|false, "service":"therapy|psychiatry|null", "suggested_actions":[], "confidence":0.0-1.0}

EJEMPLO CORRECTO DE SALUDO INICIAL:
Hola! Soy el asistente de Feliz Horizonte. Es valiente buscar ayuda, estoy aquí para guiarte. 😊 ¿En qué puedo ayudarte hoy?

{"intent":"saludo","priority":"low","notify_human":false,"service":null,"suggested_actions":["ask_service_type"],"confidence":0.95}
`.trim();

// Historial de conversaciones por teléfono
const conversationHistory = new Map();
const CONVERSATION_TTL = 60 * 60 * 1000; // 1 hora

// Protocolo de crisis (lógica similar a la de tu app.js, pero más completa)
const CRISIS_MESSAGE = `Lamento profundamente que estés sintiendo esto. Tu vida es valiosa. 🆘

→ Línea 113 (Perú, 24/7)
→ Emergencias: 116
→ Acude al hospital más cercano

Un profesional de nuestro equipo se contactará contigo de inmediato.`;

function detectCrisis(text) {
  const crisisKeywords = [
    /\b(suicid|matarme|morir|acabar con todo|quitarme la vida)\b/i,
    /\b(no quiero vivir|terminar con esto|hacerme da[ñn]o)\b/i,
    /\b(cortarme|sobredosis|lanzarme|ahorcarme|abuso|violencia|maltrato)\b/i,
  ];
  
  return crisisKeywords.some(regex => regex.test(text.toLowerCase()));
}

function handleCrisis(phone, text) {
  const message = CRISIS_MESSAGE;
  const meta = {
    intent: "crisis",
    priority: "high",
    notify_human: true,
    service: "therapy",
    suggested_actions: ["emergency_protocol", "urgent_callback"],
    confidence: 1.0,
  };
  saveToHistory(phone, text, message, meta);
  return { message, meta };
}

// ===== FUNCIÓN PRINCIPAL MEJORADA =====

export async function generateAIReply({ text, conversationContext = null, phone = null }) {
  const startTime = Date.now();
  
  // 1. Detección de crisis (rápida)
  if (detectCrisis(text)) {
    return handleCrisis(phone, text);
  }
  
  // 2. Construir contexto conversacional
  let contextPrompt = "";
  if (phone && conversationHistory.has(phone)) {
    const history = conversationHistory.get(phone);
    const recentMessages = history.messages.slice(-4);
    
    if (recentMessages.length > 0) {
      contextPrompt += "\n\n📜 CONVERSACIÓN PREVIA:\n";
      recentMessages.forEach(msg => {
        const role = msg.role === 'user' ? '👤 Cliente' : '🤖 Tú';
        contextPrompt += `${role}: "${msg.text}"\n`;
      });
      contextPrompt += "\n⚠️ NO REPITAS lo que ya dijiste. AVANZA en la conversación.\n";
    }
  }
  
  if (conversationContext) {
    contextPrompt += `\n🔍 CONTEXTO ADICIONAL:\n`;
    if (conversationContext.isHumanHandling) {
      contextPrompt += `- Un humano manejó esta conversación recientemente\n`;
    }
    if (conversationContext.awaitingScheduling) {
      contextPrompt += `- El cliente estaba en proceso de agendamiento\n`;
    }
    if (conversationContext.lastIntent) {
      contextPrompt += `- Última intención: ${conversationContext.lastIntent}\n`;
    }
  }

  // 3. Preparar input
  const input = `${BUSINESS_INFO}${contextPrompt}\n\n📱 MENSAJE ACTUAL DEL CLIENTE:\n"${text}"\n\n💬 TU RESPUESTA:`;

  try {
    // 4. Llamar a IA
    const result = await model.generateContent({
      contents: [{ parts: [{ text: input }] }],
    });
    
    let out = result.response.text().trim();
    
    // 5. PARSING ROBUSTO (Mejora)
    
    // Remover bloques de código y limpiar
    out = out.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const lines = out.split("\n");
    let rawJson = "";
    let message = "";
    
    // Buscar el JSON y asumir que el resto es el mensaje
    let jsonFound = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{") && line.includes("intent")) {
        rawJson = line;
        lines.splice(i, 1);
        jsonFound = true;
        break;
      }
    }
    
    message = lines.join("\n").trim().replace(/\s*[{}]\s*$/g, ''); // Última limpieza de { o }
    
    // 6. Parsear Meta (con fallbacks)
    let meta = {
      intent: "info",
      priority: "low",
      notify_human: false,
      service: null,
      suggested_actions: [],
      confidence: 0.6,
    };
    
    if (jsonFound) {
      try {
        const cleanJson = rawJson.replace(/\n/g, ' ').trim();
        meta = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error("❌ Error parseando JSON de IA:", parseError.message);
        // Fallback manual si JSON.parse falla
        meta = extractMetaManually(rawJson, text); 
      }
    } else {
      console.warn(`⚠️ No se encontró JSON válido, extrayendo manualmente`);
      meta = extractMetaManually(out, text);
    }
    
    // 7. CORRECCIÓN CRÍTICA: Fallback de mensaje si la IA solo envió JSON
    const MIN_MESSAGE_LENGTH = 4;
    const textLower = text.toLowerCase();
    
    if (!message || message.length < MIN_MESSAGE_LENGTH) {
      console.warn(`⚠️ Mensaje de IA vacío o muy corto (${message.length} chars). Generando fallback conversacional.`);
      
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
        case 'saludo':
        case 'info':
        default:
          message = "Hola, soy el asistente de Feliz Horizonte. ¿En qué puedo ayudarte hoy? 😊";
          // Usar un saludo más empático si es el primer contacto
          if (!conversationContext?.lastIntent) {
               message = "Hola, soy el asistente de Feliz Horizonte. Es valiente buscar ayuda, estoy aquí para guiarte. 😊 ¿En qué puedo ayudarte hoy?";
          }
          break;
      }
      
      // Si el mensaje estaba vacío, ajustamos el intent para que la respuesta de fallback sea correcta
      if (meta.intent === 'saludo' || meta.intent === 'despedida') {
        meta.intent = 'info';
      }
      meta.confidence = 0.5; // Baja la confianza para este fallback
    }
    
    // 8. Validaciones y Overrides (Lógica de negocio)
    
    // Detección manual de servicio si la IA falló (basado en el texto original)
    if (!meta.service || meta.service === 'null') {
      if (/(psicolog[íi]a|psic[óo]log[oa]|terapia|terapeuta)/i.test(textLower)) {
        meta.service = 'therapy';
      } else if (/(psiquiatr[íi]a|psiquiatra|medicamento|receta)/i.test(textLower)) {
        meta.service = 'psychiatry';
      }
    }

    // Override: Terapia + agendar = NO derivar
    if (meta.intent === 'agendar' && meta.service === 'therapy') {
      meta.notify_human = false;
      meta.suggested_actions = ['send_calendly'];
    }
    
    // Override: Psiquiatría SIEMPRE deriva si es para agendar o medicación
    if (meta.service === 'psychiatry' && (meta.intent === 'agendar' || meta.intent === 'medicacion')) {
      meta.notify_human = true;
    }

    // Detectar frustración
    const frustrationWords = ['ya te dije', 'repites', 'otra vez', 'cansado', 'molesto'];
    if (frustrationWords.some(w => textLower.includes(w)) || meta.intent === 'queja') {
      meta.notify_human = true;
      meta.priority = 'high';
    }

    // Detectar urgencia temporal
    if (/\b(hoy|ahora|ya|urgente|inmediato)\b/i.test(text) && meta.intent !== 'crisis') {
      meta.notify_human = true;
      meta.priority = 'high';
    }
    
    // Guardar en historial
    saveToHistory(phone, text, message, meta);
    
    const duration = Date.now() - startTime;
    console.log(`⚡ IA respondió en ${duration}ms | intent: ${meta.intent} | priority: ${meta.priority}`);
    
    return { message, meta };
    
  } catch (e) {
    console.error("❌ AI error:", e?.message);
    return handleAIError(phone);
  }
}

// ===== FUNCIONES AUXILIARES (DEJAR AL FINAL) =====

function extractMetaManually(rawJson, text) {
  const meta = {
    intent: "info",
    priority: "low",
    notify_human: false,
    service: null,
    suggested_actions: [],
    confidence: 0.5
  };
  
  const patterns = {
    intent: /"intent"\s*:\s*"([^"]+)"/i,
    priority: /"priority"\s*:\s*"([^"]+)"/i,
    notify_human: /"notify_human"\s*:\s*(true|false)/i,
    service: /"service"\s*:\s*"([^"]+)"/i,
    confidence: /"confidence"\s*:\s*([\d.]+)/i
  };
  
  for (const [key, regex] of Object.entries(patterns)) {
    const match = rawJson.match(regex);
    if (match) {
      if (key === 'notify_human') {
        meta[key] = match[1].toLowerCase() === 'true';
      } else if (key === 'confidence') {
        meta[key] = parseFloat(match[1]);
      } else if (key === 'service' && match[1].toLowerCase() === 'null') {
        meta[key] = null;
      } else {
        meta[key] = match[1];
      }
    }
  }
  return meta;
}

function saveToHistory(phone, userText, botMessage, meta) {
  if (!phone) return;
  
  if (!conversationHistory.has(phone)) {
    conversationHistory.set(phone, {
      messages: [],
      startedAt: Date.now(),
      lastActivity: Date.now()
    });
  }
  
  const history = conversationHistory.get(phone);
  
  history.messages.push(
    { role: 'user', text: userText, timestamp: Date.now() },
    { role: 'assistant', text: botMessage, timestamp: Date.now(), meta }
  );
  
  history.lastActivity = Date.now();
  
  if (history.messages.length > 12) {
    history.messages.splice(0, history.messages.length - 12);
  }
}

function handleAIError(phone) {
  return {
    message: "Disculpa, estoy teniendo dificultades técnicas en este momento. 😔 Un miembro de mi equipo te atenderá en breve.",
    meta: {
      intent: "error",
      priority: "high",
      notify_human: true,
      service: null,
      suggested_actions: ["transfer_human"],
      confidence: 0.1,
      error: true
    }
  };
}

export function cleanOldConversations() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [phone, history] of conversationHistory.entries()) {
    if (now - history.lastActivity > CONVERSATION_TTL) {
      conversationHistory.delete(phone);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Historial limpiado: ${cleaned} conversaciones antiguas`);
  }
}

// Ejecutar limpieza cada 30 minutos
setInterval(cleanOldConversations, 30 * 60 * 1000);

export function resetConversationHistory(phone) {
  conversationHistory.delete(phone);
  console.log(`🔄 Historial reseteado para ${phone}`);
}

export function getConversationStats() {
  return {
    activeConversations: conversationHistory.size,
    conversations: Array.from(conversationHistory.entries()).map(([phone, history]) => ({
      phone,
      messageCount: history.messages.length,
      minutesActive: Math.floor((Date.now() - history.startedAt) / 60000)
    }))
  };
}