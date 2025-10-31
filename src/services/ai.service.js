// src/services/ai.service.js - VERSIÓN MEJORADA
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";

const RAW_KEY = process.env.GEMINI_API_KEY || "";
const API_KEY = RAW_KEY.trim().replace(/^["']+|["']+$/g, "");

if (!API_KEY || !API_KEY.startsWith("AIza")) {
  console.error("❌ GEMINI_API_KEY inválida o vacía. Revisa tu .env");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const BUSINESS_INFO = `
Eres el asistente oficial de Feliz Horizonte (felizhorizonte.pe), servicio 100% online de salud mental en Perú.

PERSONALIDAD Y TONO:
- Cálido, empático y profesional
- Usa "tú" (tuteo)
- Emojis con moderación: 💙 🤗 ✨ 😊
- NUNCA seas repetitivo ni redundante
- Mantén CONTINUIDAD conversacional - recuerda lo que ya dijiste

LÍMITES PROFESIONALES:
- NUNCA diagnostiques
- NUNCA cambies ni indiques medicación
- NO prometas horarios exactos sin confirmar
- NO ofrezcas descuentos no autorizados

SERVICIOS:
1. Terapia Psicológica:
   - Precio: S/ 140 (50 min)
   - Modalidad: 100% online (Zoom/Meet)
   - Profesional: Lic. Cintya Isabel (psicóloga colegiada)
   - Enfoque: cognitivo-conductual
   - Para: ansiedad, depresión, estrés, pareja, autoestima, duelo

2. Consulta Psiquiátrica:
   - Precio: S/ 200
   - Modalidad: 100% online (Zoom/Meet)
   - Profesional: Dra. Yasmín Meneses (médica psiquiatra)
   - Incluye: evaluación médica, diagnóstico, prescripción si necesario

PAGOS: Yape, Plin, transferencia bancaria (datos se comparten al confirmar cita)

POLÍTICAS:
- Reprogramación: con 24h de anticipación sin penalización
- Confidencialidad: 100% garantizada (código ético)
- Primera sesión: evaluación inicial
- Solo con cita previa (no hay atención sin agendar)

HORARIOS (referenciales - SIEMPRE confirmar):
- Lunes a Viernes: 9:00 AM - 8:00 PM
- Sábados: 9:00 AM - 2:00 PM  
- Domingos: CERRADO

DIFERENCIAS CLAVE:
- Psicólogo: terapia conversacional, estrategias de afrontamiento
- Psiquiatra: médica(o) que puede recetar medicamentos

LINKS DE AGENDA (mencionar cuando sea relevante):
- Terapia: [el backend agregará el link de Calendly]
- Psiquiatría: [el backend agregará el link de Calendly]

INTENCIONES A DETECTAR:
- precios: pregunta por costos/tarifas
- servicios: pregunta qué ofrecen
- horarios: pregunta disponibilidad
- pago: pregunta formas de pago
- agendar: quiere reservar cita
- reprogramar: quiere cambiar cita existente
- diferencia: no sabe si elegir psicólogo o psiquiatra
- despedida: se despide o agradece
- caso_personal: comparte su situación personal
- medicacion: menciona medicamentos actuales
- queja: insatisfacción con el servicio

PRIORIDAD:
- HIGH: medicación en curso, queja, menores/pareja/familia, caso personal complejo, urgencia
- LOW: consultas generales, información básica

NOTIFY_HUMAN (cuándo derivar a humano):
- true: casos complejos, medicación, quejas, solicitudes de horarios específicos para HOY, confusión persistente
- false: consultas simples bien resueltas por IA

FORMATO DE RESPUESTA:
Línea 1-N: Tu mensaje empático para WhatsApp (3-6 líneas máximo)
Última línea: JSON de metadata en UNA SOLA LÍNEA:
{"intent":"...", "priority":"low|high", "notify_human":true|false, "service":"therapy|psychiatry|null", "suggested_actions":[], "confidence":0.0-1.0}

REGLAS CRÍTICAS ANTI-REPETICIÓN:
1. Lee el contexto conversacional COMPLETO
2. NO repitas información ya dada
3. SI ya explicaste los precios, NO los expliques de nuevo
4. SI el cliente ya eligió un servicio, AVANZA hacia el agendamiento
5. Detecta cuando el cliente está frustrado por la repetición
6. Si el cliente dice "sí" o responde afirmativamente, ASUME que acepta y continúa el flujo
7. NO regreses al mensaje de bienvenida si ya hay conversación activa

EJEMPLOS DE RESPUESTAS:

Ejemplo 1 - Primera consulta:
Cliente: "Hola, cuánto cuesta?"
Respuesta:
¡Hola! 😊 Nuestros servicios son:
• Terapia Psicológica: S/ 140 (50 min)
• Consulta Psiquiátrica: S/ 200

¿Te gustaría agendar alguna de estas opciones?
{"intent":"precios", "priority":"low", "notify_human":false, "service":null, "suggested_actions":["show_prices"], "confidence":0.95}

Ejemplo 2 - Continuación (cliente ya sabe precios):
Cliente: "psicología"
Respuesta:
Perfecto, terapia con la Lic. Cintya Isabel (S/ 140, 50 min). ¿Para cuándo te gustaría agendar? Tenemos disponibilidad de lunes a viernes de 9 AM a 8 PM, y sábados de 9 AM a 2 PM. 📅
{"intent":"agendar", "priority":"low", "notify_human":true, "service":"therapy", "suggested_actions":["send_calendly_link"], "confidence":0.9}

Ejemplo 3 - Cliente frustrado por repetición:
Cliente: "me ibas a dar una cita"
Respuesta:
Tienes razón, disculpa. Para agendar tu cita de terapia psicológica necesito derivarte con mi equipo que tiene acceso al calendario en tiempo real. Ellos te confirmarán el horario disponible de inmediato. 😊
{"intent":"agendar", "priority":"high", "notify_human":true, "service":"therapy", "suggested_actions":["transfer_to_human"], "confidence":0.85}

NO PIDAS NI GUARDES DATOS SENSIBLES (diagnósticos, medicamentos específicos, historias clínicas detalladas) por chat.
`.trim();

// 🆕 NUEVO: Historial de conversaciones por teléfono
const conversationHistory = new Map(); // phone -> [messages]

export async function generateAIReply({ text, conversationContext = null, phone = null }) {
  // 🆕 Construir contexto conversacional
  let contextPrompt = "";
  
  if (phone && conversationHistory.has(phone)) {
    const history = conversationHistory.get(phone);
    const recentMessages = history.slice(-4); // Últimos 4 mensajes
    
    if (recentMessages.length > 0) {
      contextPrompt = "\n\nCONTEXTO DE CONVERSACIÓN PREVIA:\n";
      recentMessages.forEach((msg, idx) => {
        contextPrompt += `${msg.role === 'user' ? 'Cliente' : 'Tú'}: "${msg.text}"\n`;
      });
      contextPrompt += "\nIMPORTANTE: NO repitas lo que ya dijiste. Continúa la conversación naturalmente.\n";
    }
  }
  
  if (conversationContext) {
    contextPrompt += `\nCONTEXTO ADICIONAL:\n`;
    if (conversationContext.isHumanHandling) {
      contextPrompt += `- Un humano acaba de manejar esta conversación\n`;
    }
    if (conversationContext.awaitingScheduling) {
      contextPrompt += `- El cliente estaba en proceso de agendamiento\n`;
    }
    if (conversationContext.lastIntent) {
      contextPrompt += `- Última intención detectada: ${conversationContext.lastIntent}\n`;
    }
  }

  const input = `${BUSINESS_INFO}${contextPrompt}\n\nMensaje actual del cliente:\n"${text}"\n\nRespuesta:`;

  try {
    const result = await model.generateContent({
      contents: [{ parts: [{ text: input }] }],
    });
    const out = result.response.text().trim();

    // Separar respuesta y JSON
    const lines = out.split("\n");
    let rawJson = lines[lines.length - 1];
    
    // Buscar el JSON (puede estar en cualquier línea que empiece con {)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("{")) {
        rawJson = lines[i].trim();
        lines.splice(i, 1);
        break;
      }
    }
    
    const message = lines.join("\n").trim();

    let meta = {
      intent: "info",
      priority: "low",
      notify_human: false,
      service: null,
      suggested_actions: [],
      confidence: 0.6,
    };
    
    try {
      // Limpiar el JSON de posibles backticks o markdown
      const cleanJson = rawJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      meta = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("❌ Error parseando JSON de IA:", parseError.message);
      console.error("JSON recibido:", rawJson);
      // Intentar extraer manualmente algunos campos clave
      try {
        const intentMatch = rawJson.match(/"intent"\s*:\s*"([^"]+)"/);
        const priorityMatch = rawJson.match(/"priority"\s*:\s*"([^"]+)"/);
        const notifyMatch = rawJson.match(/"notify_human"\s*:\s*(true|false)/);
        
        if (intentMatch) meta.intent = intentMatch[1];
        if (priorityMatch) meta.priority = priorityMatch[1];
        if (notifyMatch) meta.notify_human = notifyMatch[1] === 'true';
      } catch {
        // Usar valores por defecto
      }
    }

    // 🆕 Guardar en historial
    if (phone) {
      if (!conversationHistory.has(phone)) {
        conversationHistory.set(phone, []);
      }
      const history = conversationHistory.get(phone);
      history.push({ role: 'user', text, timestamp: Date.now() });
      history.push({ role: 'assistant', text: message, timestamp: Date.now() });
      
      // Mantener solo los últimos 10 mensajes (5 intercambios)
      if (history.length > 10) {
        history.splice(0, history.length - 10);
      }
    }

    // 🆕 Lógica adicional: si detectamos frustración, siempre derivar a humano
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

    // 🆕 Si el cliente menciona "hoy" o "ahora", derivar a humano
    if (/\b(hoy|ahora|ahorita|ya|inmediato)\b/i.test(text) && 
        (meta.intent === 'agendar' || meta.intent === 'horarios')) {
      meta.notify_human = true;
      console.log(`⚠️ Solicitud urgente detectada: "${text}"`);
    }

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

// 🆕 NUEVO: Función para limpiar historial viejo
export function cleanOldConversations() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  for (const [phone, history] of conversationHistory.entries()) {
    if (history.length === 0) {
      conversationHistory.delete(phone);
      continue;
    }
    
    const lastMessage = history[history.length - 1];
    if (now - lastMessage.timestamp > ONE_HOUR) {
      conversationHistory.delete(phone);
      console.log(`🧹 Historial limpiado para ${phone}`);
    }
  }
}

// Limpiar cada 30 minutos
setInterval(cleanOldConversations, 30 * 60 * 1000);

// 🆕 NUEVO: Exportar función para resetear historial (útil para testing)
export function resetConversationHistory(phone) {
  conversationHistory.delete(phone);
  console.log(`🔄 Historial reseteado para ${phone}`);
}