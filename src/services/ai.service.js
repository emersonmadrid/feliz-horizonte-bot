// src/services/ai.service.js - VERSIÓN MEJORADA CON MEJOR DETECCIÓN
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

// REEMPLAZAR en src/services/ai.service.js - Sección del BUSINESS_INFO

const BUSINESS_INFO = `
Eres el asistente oficial de Feliz Horizonte (felizhorizonte.pe), servicio 100% online de salud mental en Perú.

PERSONALIDAD Y TONO:
- Cálido, empático y profesional
- Usa "tú" (tuteo)
- Emojis con moderación: 💙 🤗 ✨ 😊
- NUNCA seas repetitivo ni redundante
- Mantén CONTINUIDAD conversacional

LÍMITES PROFESIONALES:
- NUNCA diagnostiques
- NUNCA cambies ni indiques medicación
- NO prometas horarios exactos sin confirmar
- NO ofrezcas descuentos no autorizados

SERVICIOS:
1. Terapia Psicológica (psicología, psicólogo, terapia):
   - Precio: S/ 140 (50 min)
   - Modalidad: 100% online (Zoom/Meet)
   - Profesional: Lic. Cintya Isabel (psicóloga colegiada)
   - Enfoque: cognitivo-conductual

2. Consulta Psiquiátrica (psiquiatría, psiquiatra):
   - Precio: S/ 200
   - Modalidad: 100% online (Zoom/Meet)
   - Profesional: Dra. Yasmín Meneses (médica psiquiatra)
   - Incluye: evaluación médica, diagnóstico, prescripción si necesario

PAGOS: Yape, Plin, transferencia bancaria

POLÍTICAS:
- Reprogramación: con 24h de anticipación sin penalización
- Confidencialidad: 100% garantizada
- Primera sesión: evaluación inicial
- Solo con cita previa

HORARIOS (referenciales):
- Lunes a Viernes: 9:00 AM - 8:00 PM
- Sábados: 9:00 AM - 2:00 PM  
- Domingos: CERRADO

DIFERENCIAS CLAVE:
- Psicólogo: terapia conversacional, estrategias de afrontamiento
- Psiquiatra: médica(o) que puede recetar medicamentos

DETECCIÓN DE SERVICIO - MUY IMPORTANTE:
Si el cliente menciona:
- "psicología", "psicólogo", "psicóloga", "terapia", "terapeuta" → service: "therapy"
- "psiquiatría", "psiquiatra" → service: "psychiatry"
- Si NO especifica → service: null (preguntar cuál prefiere)

INTENCIONES A DETECTAR:
- agendar: quiere reservar cita (palabras clave: "quiero cita", "agendar", "reservar", "para psicología", "con psicólogo")
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

PRIORIDAD Y DERIVACIÓN A HUMANO - REGLAS CRÍTICAS:

✅ MANTENER EN IA (notify_human: false):
- Consultas sobre precios, horarios, servicios, pagos
- Agendamiento simple de terapia (enviar link Calendly)
- Preguntas sobre diferencias psicólogo/psiquiatra
- Menciones simples de terceros: "para mi mamá", "mi papá necesita", "mi esposo" → ESTO ES NORMAL, solo agendar
- Contexto familiar básico sin crisis: "mi hijo tiene ansiedad", "mi pareja está triste"

❌ DERIVAR A HUMANO (notify_human: true):
- Medicación psiquiátrica en curso o cambios recientes
- Quejas o insatisfacción con el servicio
- Casos de MENORES con riesgo (abuso, ideación suicida, violencia)
- Crisis familiar severa (violencia doméstica, duelo traumático reciente)
- Solicitud de horario específico HOY o AHORA (urgencia temporal)
- Agendamiento de PSIQUIATRÍA (siempre requiere coordinación humana)
- Confusión persistente después de 3 mensajes
- Situaciones médicas complejas (comorbilidades severas)

REGLA DE ORO:
"Para mi [familiar]" NO es razón para derivar a humano si solo quieren agendar.
Solo deriva si hay RIESGO, CRISIS o COMPLEJIDAD MÉDICA real.

FORMATO DE RESPUESTA:
Línea 1-N: Tu mensaje empático para WhatsApp (3-6 líneas máximo)
Última línea: JSON de metadata en UNA SOLA LÍNEA:
{"intent":"...", "priority":"low|high", "notify_human":true|false, "service":"therapy|psychiatry|null", "suggested_actions":[], "confidence":0.0-1.0}

EJEMPLOS CRÍTICOS:

Ejemplo 1 - "Necesito para mi papá":
Respuesta:
¡Perfecto! Nuestras terapias son para todas las edades. 😊 ¿Tu papá prefiere psicología o psiquiatría? Así te comparto los detalles y el link para agendar.
{"intent":"agendar", "priority":"low", "notify_human":false, "service":null, "suggested_actions":["ask_service_type"], "confidence":0.9}

Ejemplo 2 - "Es para mi hijo de 15 años, tiene ansiedad":
Respuesta:
Entiendo. La terapia psicológica puede ayudar mucho con la ansiedad en adolescentes. La Lic. Cintya trabaja con jóvenes también. ¿Te gustaría agendar una sesión? 💙
{"intent":"agendar", "priority":"low", "notify_human":false, "service":"therapy", "suggested_actions":["send_calendly"], "confidence":0.9}

Ejemplo 3 - "Mi hijo de 10 años tiene pensamientos suicidas":
Respuesta:
Comprendo tu preocupación. Esta situación requiere atención especializada inmediata. Un profesional de nuestro equipo se pondrá en contacto contigo de inmediato para coordinar la mejor forma de ayudar. 🆘
{"intent":"caso_personal", "priority":"high", "notify_human":true, "service":"therapy", "suggested_actions":["urgent_callback"], "confidence":1.0}

Ejemplo 4 - "Quiero cita de psiquiatría para mi esposa":
Respuesta:
Perfecto. Para coordinar la consulta psiquiátrica con la Dra. Yasmín Meneses (S/ 200), un miembro del equipo te contactará para confirmar disponibilidad. 👤
{"intent":"agendar", "priority":"low", "notify_human":true, "service":"psychiatry", "suggested_actions":["transfer_human"], "confidence":0.95}

REGLAS ANTI-REPETICIÓN:
1. Lee el contexto conversacional COMPLETO
2. NO repitas información ya dada
3. SI ya explicaste los precios, NO los expliques de nuevo
4. SI el cliente ya eligió un servicio, AVANZA hacia el agendamiento
5. Si el cliente dice "sí" o confirma, ASUME que acepta y envía el link
6. NO regreses al mensaje de bienvenida si ya hay conversación activa

NO PIDAS NI GUARDES DATOS SENSIBLES por chat.
`.trim();

// Historial de conversaciones por teléfono
const conversationHistory = new Map();

export async function generateAIReply({ text, conversationContext = null, phone = null }) {
  // Construir contexto conversacional
  let contextPrompt = "";
  
  if (phone && conversationHistory.has(phone)) {
    const history = conversationHistory.get(phone);
    const recentMessages = history.slice(-4);
    
    if (recentMessages.length > 0) {
      contextPrompt = "\n\nCONTEXTO DE CONVERSACIÓN PREVIA:\n";
      recentMessages.forEach((msg, idx) => {
        contextPrompt += `${msg.role === 'user' ? 'Cliente' : 'Tú'}: "${msg.text}"\n`;
      });
      contextPrompt += "\nIMPORTANTE: NO repitas lo que ya dijiste. Si el cliente ya eligió el servicio, envía el link directamente.\n";
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
    
    // Buscar el JSON
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
      const cleanJson = rawJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      meta = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("❌ Error parseando JSON de IA:", parseError.message);
      console.error("JSON recibido:", rawJson);
      
      // Intentar extraer manualmente
      try {
        const intentMatch = rawJson.match(/"intent"\s*:\s*"([^"]+)"/);
        const priorityMatch = rawJson.match(/"priority"\s*:\s*"([^"]+)"/);
        const notifyMatch = rawJson.match(/"notify_human"\s*:\s*(true|false)/);
        const serviceMatch = rawJson.match(/"service"\s*:\s*"([^"]+)"/);
        
        if (intentMatch) meta.intent = intentMatch[1];
        if (priorityMatch) meta.priority = priorityMatch[1];
        if (notifyMatch) meta.notify_human = notifyMatch[1] === 'true';
        if (serviceMatch) meta.service = serviceMatch[1] === 'null' ? null : serviceMatch[1];
      } catch {
        // Usar valores por defecto
      }
    }

    // 🆕 NUEVO: Detección manual de servicio si la IA falló
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

    // 🆕 NUEVO: Si detecta "agendar" + "therapy", NO derivar a humano
    if (meta.intent === 'agendar' && meta.service === 'therapy') {
      meta.notify_human = false;
      console.log(`🔧 Override: agendamiento de terapia = auto-respuesta`);
    }

    // Guardar en historial
    if (phone) {
      if (!conversationHistory.has(phone)) {
        conversationHistory.set(phone, []);
      }
      const history = conversationHistory.get(phone);
      history.push({ role: 'user', text, timestamp: Date.now() });
      history.push({ role: 'assistant', text: message, timestamp: Date.now() });
      
      if (history.length > 10) {
        history.splice(0, history.length - 10);
      }
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

// Función para limpiar historial viejo
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

setInterval(cleanOldConversations, 30 * 60 * 1000);

export function resetConversationHistory(phone) {
  conversationHistory.delete(phone);
  console.log(`🔄 Historial reseteado para ${phone}`);
}