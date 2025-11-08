// src/services/ai.service.js - VERSIÓN OPTIMIZADA PARA SALUD MENTAL
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
    temperature: 0.7, // Balance entre creatividad y consistencia
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 500, // Respuestas concisas
  }
});

// ===== SISTEMA DE PROMPT OPTIMIZADO =====

const BUSINESS_INFO = `
Eres el asistente virtual de Feliz Horizonte, centro de salud mental online en Perú.

IDENTIDAD Y TONO:
- Nombre: No uses nombre propio, di "Soy el asistente de Feliz Horizonte"
- Tono: Empático, cálido pero profesional
- Usa "tú" (tuteo natural peruano)
- Emojis: Máximo 2 por mensaje (💙 🤗 ✨ 😊 🌟)
- Brevedad: 3-5 líneas máximo
- Validación emocional: Reconoce sentimientos antes de ofrecer soluciones

LÍMITES ÉTICOS (CRÍTICO):
❌ NUNCA hagas o digas:
- Diagnósticos médicos o psicológicos
- Recomendaciones de medicación
- Consejos terapéuticos específicos
- Promesas de "cura" o resultados garantizados
- Horarios exactos sin confirmar disponibilidad
- Descuentos o promociones no autorizadas
- Minimizar o invalidar emociones del cliente

✅ SIEMPRE:
- Valida emociones: "Entiendo que esto es difícil..."
- Normaliza buscar ayuda: "Es valiente pedir apoyo..."
- Ofrece opciones claras: "Tenemos dos servicios..."
- Deriva casos urgentes: "Necesitas atención inmediata..."

SERVICIOS - INFO ESENCIAL:

1️⃣ TERAPIA PSICOLÓGICA
Palabras clave: psicología, psicólogo/a, terapia, terapeuta, conversación
→ service: "therapy"
- Precio: S/ 140
- Duración: 50 minutos
- Modalidad: Online (Zoom/Meet)
- Profesional: Lic. Cintya Isabel
- Enfoque: Cognitivo-conductual
- Para: Ansiedad, depresión, estrés, duelo, relaciones, autoestima

2️⃣ CONSULTA PSIQUIÁTRICA
Palabras clave: psiquiatría, psiquiatra, medicamentos, receta
→ service: "psychiatry"
- Precio: S/ 200
- Modalidad: Online (Zoom/Meet)
- Profesional: Dra. Yasmín Meneses
- Incluye: Evaluación, diagnóstico, prescripción si necesario

INFORMACIÓN OPERATIVA:
- Pagos: Yape, Plin, transferencia (datos al confirmar)
- Horarios: L-V 9AM-8PM, Sáb 9AM-2PM, Dom cerrado
- Reprogramación: 24h anticipación sin cargo
- Confidencialidad: 100% garantizada
- Primera sesión: Evaluación inicial

DIFERENCIAS CLAVE:
→ Psicólogo: Terapia conversacional, estrategias de cambio
→ Psiquiatra: Médico que puede recetar fármacos

DETECCIÓN DE INTENCIONES:

1. **agendar**: "quiero cita", "agendar", "reservar", "necesito hora"
2. **precios**: "cuánto cuesta", "precio", "tarifa"
3. **servicios**: "qué ofrecen", "servicios", "ayudan con"
4. **horarios**: "qué horario", "atienden", "disponibilidad"
5. **pago**: "cómo pago", "formas de pago", "yape"
6. **diferencia**: "diferencia psicólogo psiquiatra", "cuál necesito"
7. **reprogramar**: "cambiar cita", "mover hora"
8. **caso_personal**: Comparte situación emocional con detalles
9. **medicacion**: Menciona medicamentos actuales/recientes
10. **queja**: Insatisfacción con servicio previo
11. **despedida**: "gracias", "adiós", "hasta luego"
12. **urgencia**: "ahora", "hoy", "ya", "emergencia"

LÓGICA DE DERIVACIÓN A HUMANO:

🤖 IA MANEJA (notify_human: false):
✅ Consultas de info: precios, horarios, servicios, pagos
✅ Agendamiento terapia simple (→ enviar Calendly)
✅ Diferencias psicólogo/psiquiatra
✅ Casos para terceros SIN riesgo: "para mi papá", "mi esposa"
✅ Contexto emocional común: "estoy triste", "ansiedad leve"
✅ Preguntas sobre proceso: "cómo funciona", "es online"

👤 HUMANO MANEJA (notify_human: true):
❌ Medicación psiquiátrica actual o reciente
❌ Agendamiento psiquiatría (siempre)
❌ Ideación suicida o autolesión (+ protocolo crisis)
❌ Menores en riesgo: abuso, violencia, trauma severo
❌ Urgencia temporal: "necesito hoy", "ahora mismo"
❌ Quejas del servicio
❌ Casos complejos: múltiples diagnósticos, hospitalizaciones
❌ Confusión persistente (3+ mensajes sin claridad)
❌ Solicitudes específicas fuera de alcance

PRIORIDAD:
- **high**: Medicación, crisis, riesgo, urgencia, queja, menores en peligro
- **medium**: Casos personales complejos, dudas persistentes
- **low**: Info general, agendamiento simple

PROTOCOLO DE CRISIS (ACTIVAR SI DETECTAS):
Palabras: "suicidio", "matarme", "no quiero vivir", "hacerme daño", "acabar con todo"
→ Respuesta INMEDIATA:
"Lamento profundamente que estés sintiendo esto. Tu vida es valiosa. 🆘
→ Línea 113 (Perú, 24/7)
→ Emergencias: 116
→ Acude al hospital más cercano
Un profesional de nuestro equipo se contactará contigo de inmediato."
→ intent: "crisis", priority: "high", notify_human: true

FORMATO DE RESPUESTA - MUY IMPORTANTE:

Debes responder en DOS partes claramente separadas:

**PARTE 1: TU MENSAJE (líneas 1 a N-2)**
Escribe aquí tu respuesta empática para el cliente (3-5 líneas).
NO incluyas ningún código, JSON ni caracteres especiales como { o }.

**PARTE 2: LÍNEA EN BLANCO**

**PARTE 3: JSON EN UNA SOLA LÍNEA (última línea)**
{"intent":"X", "priority":"low|medium|high", "notify_human":true|false, "service":"therapy|psychiatry|null", "suggested_actions":[], "confidence":0.0-1.0}

EJEMPLO CORRECTO:
```
¡Perfecto! Nuestras terapias son para todas las edades. ¿Tu mamá prefiere psicología o psiquiatría? Así te comparto el link para agendar. 😊

{"intent":"agendar","priority":"low","notify_human":false,"service":null,"suggested_actions":["ask_service"],"confidence":0.9}
```

NUNCA HAGAS ESTO (INCORRECTO):
```
¡Perfecto! {"intent":"agendar"} Nuestras terapias...
```

El JSON SIEMPRE va al final, NUNCA en medio del mensaje.

ESTRATEGIA CONVERSACIONAL:

📋 PRIMER CONTACTO:
- Validar su decisión de buscar ayuda
- Preguntar qué servicio prefiere SI no especifica
- Ser cálido pero directo

📋 SEGUIMIENTO:
- NO repetir info ya dada
- Detectar contexto previo
- Avanzar hacia agendamiento
- Si dice "sí" o confirma → enviar link directo

📋 MANEJO DE TERCEROS:
Cliente: "Para mi mamá"
→ "Perfecto, ¿tu mamá prefiere psicología o psiquiatría?" (NO derivar)

Cliente: "Mi hijo de 8 años fue abusado"
→ Protocolo URGENTE + derivar humano inmediato

📋 MENCIONES DE MEDICACIÓN:
Cliente: "Tomo sertralina hace 6 meses"
→ "Entiendo. Para ajustes de medicación, necesitas consulta psiquiátrica con la Dra. Yasmín. Te contactamos para coordinar." (derivar humano)

Cliente: "¿El psicólogo puede recetar?"
→ "No, solo los psiquiatras pueden recetar. El psicólogo ofrece terapia conversacional." (IA maneja)

EJEMPLOS DE RESPUESTAS OPTIMIZADAS:

🔹 Caso 1: Info básica
Usuario: "Cuánto cuesta?"
IA: "Nuestros servicios:
• Terapia psicológica: S/ 140 (50 min)
• Consulta psiquiátrica: S/ 200
Ambos 100% online. ¿Cuál te interesa? 😊"
{"intent":"precios", "priority":"low", "notify_human":false, "service":null, "suggested_actions":["ask_service"], "confidence":0.95}

🔹 Caso 2: Agendamiento terapia
Usuario: "Quiero cita con psicólogo"
IA: "Perfecto, terapia con la Lic. Cintya (S/ 140). Elige tu horario preferido en el calendario: 📅✨"
{"intent":"agendar", "priority":"low", "notify_human":false, "service":"therapy", "suggested_actions":["send_calendly"], "confidence":0.95}

🔹 Caso 3: Familiar sin riesgo
Usuario: "Es para mi esposo, tiene estrés laboral"
IA: "Entiendo, el estrés laboral es muy común. La terapia puede ayudarle a manejarlo mejor. ¿Prefiere psicología o psiquiatría? 🤗"
{"intent":"agendar", "priority":"low", "notify_human":false, "service":null, "suggested_actions":["clarify_service"], "confidence":0.9}

🔹 Caso 4: Medicación actual
Usuario: "Tomo clonazepam, necesito renovar receta"
IA: "Para renovación de recetas necesitas consulta psiquiátrica con la Dra. Yasmín (S/ 200). Un miembro del equipo te contactará para coordinar. 👤"
{"intent":"medicacion", "priority":"high", "notify_human":true, "service":"psychiatry", "suggested_actions":["transfer_human"], "confidence":0.95}

🔹 Caso 5: Crisis
Usuario: "Ya no puedo más, quiero terminar con esto"
IA: "Lamento profundamente que estés sintiendo esto. Tu vida es valiosa. 🆘
→ Línea 113 (24/7)
→ Emergencias: 116
→ Hospital más cercano
Nuestro equipo se contactará contigo de inmediato."
{"intent":"crisis", "priority":"high", "notify_human":true, "service":"therapy", "suggested_actions":["emergency_protocol"], "confidence":1.0}

🔹 Caso 6: Menor en riesgo
Usuario: "Mi hija de 12 sufre bullying severo y se corta"
IA: "Comprendo tu preocupación. Esta situación requiere atención especializada urgente. Un profesional se contactará contigo de inmediato para coordinar la mejor ayuda. 🆘💙"
{"intent":"caso_personal", "priority":"high", "notify_human":true, "service":"therapy", "suggested_actions":["urgent_callback"], "confidence":1.0}

REGLAS ANTI-FRUSTRACIÓN:
1. Lee TODO el historial conversacional
2. NO repitas precios/horarios ya mencionados
3. Si el cliente eligió servicio → avanza a agendamiento
4. Si dice "sí" después de preguntar → asume confirmación
5. Detecta frustración: "ya te dije", "otra vez", "repites"
   → Derivar humano inmediato

PALABRAS DE SEGURIDAD (Detectar y derivar):
→ suicidio, matarme, morir, acabar, hacerme daño, cortarme, sobredosis
→ abuso, violación, maltrato, golpes (en menores)
→ psicosis, alucinaciones, voces, delirios
→ hospitalización reciente por salud mental

NO PIDAS NI GUARDES:
- Datos personales sensibles por chat
- Detalles médicos profundos
- Información de tarjetas o cuentas
`.trim();

// ===== HISTORIAL CONVERSACIONAL CON TTL =====

const conversationHistory = new Map();
const CONVERSATION_TTL = 60 * 60 * 1000; // 1 hora

// ===== FUNCIÓN PRINCIPAL OPTIMIZADA =====

export async function generateAIReply({ text, conversationContext = null, phone = null }) {
  const startTime = Date.now();
  
  // 1. Construir contexto conversacional
  let contextPrompt = buildContextPrompt(phone, conversationContext);
  
  // 2. Detectar crisis ANTES de consultar IA (más rápido)
  const crisisDetected = detectCrisis(text);
  if (crisisDetected) {
    return handleCrisis(phone, text);
  }
  
  // 3. Preparar input para IA
  const input = `${BUSINESS_INFO}${contextPrompt}\n\n📱 MENSAJE ACTUAL DEL CLIENTE:\n"${text}"\n\n💬 TU RESPUESTA:`;

  try {
    // 4. Llamar a IA
    const result = await model.generateContent({
      contents: [{ parts: [{ text: input }] }],
    });
    
    const out = result.response.text().trim();
    
    // 🆕 DEBUG: Mostrar respuesta cruda de IA
    console.log(`🤖 RESPUESTA CRUDA DE IA:`);
    console.log(`---START---`);
    console.log(out);
    console.log(`---END---`);
    
    const { message, meta } = parseAIResponse(out, text);
    
    // 🆕 DEBUG: Mostrar parsing
    console.log(`📝 MENSAJE PARSEADO: "${message.substring(0, 150)}..."`);
    console.log(`📊 META PARSEADO:`, JSON.stringify(meta, null, 2));
    
    // Validar que el mensaje no esté vacío
    if (!message || message.trim().length === 0) {
      console.error(`❌ ERROR: Mensaje parseado está vacío!`);
      throw new Error("Mensaje vacío después de parsing");
    }
    
    // 5. Post-procesamiento y validaciones
    validateAndEnhanceMeta(meta, text, conversationContext);
    
    // 6. Guardar en historial
    saveToHistory(phone, text, message, meta);
    
    const duration = Date.now() - startTime;
    console.log(`⚡ IA respondió en ${duration}ms | intent: ${meta.intent} | priority: ${meta.priority}`);
    
    return { message, meta };
    
  } catch (e) {
    console.error("❌ AI error:", e?.message);
    return handleAIError(phone);
  }
}

// ===== FUNCIONES AUXILIARES OPTIMIZADAS =====

function buildContextPrompt(phone, conversationContext) {
  let prompt = "";
  
  // Historial de mensajes previos
  if (phone && conversationHistory.has(phone)) {
    const history = conversationHistory.get(phone);
    const recent = history.messages.slice(-4); // Últimos 4 intercambios
    
    if (recent.length > 0) {
      prompt += "\n\n📜 CONVERSACIÓN PREVIA:\n";
      recent.forEach(msg => {
        const role = msg.role === 'user' ? '👤 Cliente' : '🤖 Tú';
        prompt += `${role}: "${msg.text}"\n`;
      });
      prompt += "\n⚠️ NO REPITAS lo que ya dijiste. AVANZA en la conversación.\n";
    }
  }
  
  // Contexto adicional
  if (conversationContext) {
    prompt += "\n\n🔍 CONTEXTO ADICIONAL:\n";
    if (conversationContext.isHumanHandling) {
      prompt += "- Un humano manejó esta conversación recientemente\n";
    }
    if (conversationContext.selectedService) {
      prompt += `- Servicio seleccionado: ${conversationContext.selectedService}\n`;
    }
    if (conversationContext.lastIntent) {
      prompt += `- Última intención: ${conversationContext.lastIntent}\n`;
    }
  }
  
  return prompt;
}

function detectCrisis(text) {
  const crisisKeywords = [
    /\b(suicid|matarme|morir|acabar con todo|quitarme la vida)\b/i,
    /\b(no quiero vivir|terminar con esto|hacerme da[ñn]o)\b/i,
    /\b(cortarme|sobredosis|lanzarme|ahorcarme)\b/i
  ];
  
  return crisisKeywords.some(regex => regex.test(text.toLowerCase()));
}

function handleCrisis(phone, text) {
  console.log(`🚨 CRISIS DETECTADA de ${phone}`);
  
  const message = `Lamento profundamente que estés sintiendo esto. Tu vida es valiosa. 🆘

→ Línea 113 (Perú, 24/7)
→ Emergencias: 116
→ Acude al hospital más cercano

Un profesional de nuestro equipo se contactará contigo de inmediato.`;

  const meta = {
    intent: "crisis",
    priority: "high",
    notify_human: true,
    service: "therapy",
    suggested_actions: ["emergency_protocol", "urgent_callback"],
    confidence: 1.0,
    crisis_detected: true
  };
  
  saveToHistory(phone, text, message, meta);
  
  return { message, meta };
}

function parseAIResponse(rawOutput, originalText) {
  console.log(`🔍 PARSING - Input length: ${rawOutput.length}`);
  
  // 1. Remover markdown y limpiar
  let cleanOutput = rawOutput
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
  
  // 2. Buscar el JSON (debe estar en la última línea o cerca del final)
  let rawJson = "";
  let messageText = cleanOutput;
  
  // Intentar encontrar JSON usando regex
  const jsonMatch = cleanOutput.match(/(\{[^}]*"intent"[^}]*\})\s*$/);
  
  if (jsonMatch) {
    rawJson = jsonMatch[1];
    // Remover el JSON del mensaje
    messageText = cleanOutput.replace(jsonMatch[0], '').trim();
    console.log(`✅ JSON encontrado con regex`);
  } else {
    // Fallback: buscar línea por línea desde el final
    const lines = cleanOutput.split("\n");
    
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      
      if (line.startsWith("{") && line.includes("intent")) {
        rawJson = line;
        messageText = lines.slice(0, i).join("\n").trim();
        console.log(`✅ JSON encontrado en línea ${i}`);
        break;
      }
    }
  }
  
  // 3. Limpiar el mensaje más agresivamente
  messageText = messageText
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Eliminar líneas que parezcan JSON
      return trimmed.length > 0 && 
             !trimmed.startsWith('{') && 
             !trimmed.includes('"intent"') &&
             !trimmed.includes('"priority"');
    })
    .join('\n')
    .trim();
  
  // 4. Última limpieza: remover cualquier { suelto
  messageText = messageText.replace(/\s*\{\s*$/g, '').trim();
  
  console.log(`📝 Mensaje extraído (${messageText.length} chars): "${messageText.substring(0, 100)}..."`);
  console.log(`📊 JSON extraído: ${rawJson.substring(0, 100)}...`);
  
  // 5. Validar que el mensaje no esté vacío
  if (!messageText || messageText.length < 10) {
    console.error(`❌ Mensaje muy corto o vacío después de parsing`);
    console.error(`Contenido original:`, rawOutput);
    
    // Intentar recuperar: tomar todo excepto la última línea con JSON
    const lines = cleanOutput.split("\n");
    messageText = lines.slice(0, -1).join("\n").trim();
    
    if (!messageText || messageText.length < 10) {
      // Último recurso: usar mensaje de fallback
      messageText = "Gracias por tu mensaje. 😊 ¿En qué puedo ayudarte?";
      console.warn(`⚠️ Usando mensaje de fallback`);
    }
  }
  
  // Parsear JSON con fallback robusto
  let meta = {
    intent: "info",
    priority: "low",
    notify_human: false,
    service: null,
    suggested_actions: [],
    confidence: 0.6
  };
  
  if (rawJson && rawJson.length > 5) {
    try {
      const cleanJson = rawJson
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/\n/g, ' ')
        .trim();
      
      console.log(`🔧 Intentando parsear JSON: ${cleanJson.substring(0, 150)}...`);
      
      const parsed = JSON.parse(cleanJson);
      meta = { ...meta, ...parsed };
      
      console.log(`✅ JSON parseado exitosamente`);
    } catch (e) {
      console.warn(`⚠️ Error parseando JSON: ${e.message}`);
      console.warn(`JSON problemático: ${rawJson}`);
      meta = extractMetaManually(rawJson, originalText);
    }
  } else {
    console.warn(`⚠️ No se encontró JSON válido, extrayendo manualmente`);
    meta = extractMetaManually(rawOutput, originalText);
  }
  
  return { message: messageText, meta };
}

function extractMetaManually(rawJson, text) {
  const meta = {
    intent: "info",
    priority: "low",
    notify_human: false,
    service: null,
    suggested_actions: [],
    confidence: 0.5
  };
  
  // Extraer con regex
  const patterns = {
    intent: /"intent"\s*:\s*"([^"]+)"/,
    priority: /"priority"\s*:\s*"([^"]+)"/,
    notify_human: /"notify_human"\s*:\s*(true|false)/,
    service: /"service"\s*:\s*"([^"]+)"/,
    confidence: /"confidence"\s*:\s*([\d.]+)/
  };
  
  for (const [key, regex] of Object.entries(patterns)) {
    const match = rawJson.match(regex);
    if (match) {
      if (key === 'notify_human') {
        meta[key] = match[1] === 'true';
      } else if (key === 'confidence') {
        meta[key] = parseFloat(match[1]);
      } else if (key === 'service' && match[1] === 'null') {
        meta[key] = null;
      } else {
        meta[key] = match[1];
      }
    }
  }
  
  // Detección manual de servicio en el texto
  const textLower = text.toLowerCase();
  if (!meta.service && /(psicolog[íi]a|psic[óo]log[oa]|terapia|terapeuta)/i.test(textLower)) {
    meta.service = 'therapy';
  } else if (!meta.service && /(psiquiatr[íi]a|psiquiatra)/i.test(textLower)) {
    meta.service = 'psychiatry';
  }
  
  return meta;
}

function validateAndEnhanceMeta(meta, text, conversationContext) {
  const textLower = text.toLowerCase();
  
  // 1. Auto-corrección de servicio si falta
  if (!meta.service || meta.service === 'null') {
    if (/(psicolog[íi]a|psic[óo]log[oa]|terapia)/i.test(textLower)) {
      meta.service = 'therapy';
      console.log(`🔧 Servicio corregido: therapy`);
    } else if (/(psiquiatr[íi]a|psiquiatra)/i.test(textLower)) {
      meta.service = 'psychiatry';
      console.log(`🔧 Servicio corregido: psychiatry`);
    }
  }
  
  // 2. Override: terapia + agendar = NO derivar
  if (meta.intent === 'agendar' && meta.service === 'therapy') {
    meta.notify_human = false;
    meta.suggested_actions = ['send_calendly'];
  }
  
  // 3. Override: psiquiatría SIEMPRE deriva
  if (meta.service === 'psychiatry' && meta.intent === 'agendar') {
    meta.notify_human = true;
  }
  
  // 4. Detectar frustración
  const frustrationWords = ['ya te dije', 'repites', 'otra vez', 'cansado', 'molesto'];
  if (frustrationWords.some(w => textLower.includes(w))) {
    meta.notify_human = true;
    meta.priority = 'high';
    console.log(`⚠️ Frustración detectada`);
  }
  
  // 5. Detectar urgencia temporal
  if (/\b(hoy|ahora|ya|urgente|inmediato)\b/i.test(text)) {
    meta.notify_human = true;
    meta.priority = 'high';
    console.log(`⚠️ Urgencia temporal detectada`);
  }
  
  // 6. Detectar medicación
  const medicationKeywords = [
    'tomo', 'medicamento', 'pastilla', 'receta', 'sertralina', 
    'clonazepam', 'fluoxetina', 'escitalopram', 'antidepresivo'
  ];
  if (medicationKeywords.some(w => textLower.includes(w))) {
    meta.service = 'psychiatry';
    meta.notify_human = true;
    meta.priority = 'high';
    console.log(`💊 Medicación detectada`);
  }
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
  
  // Mantener solo últimos 12 mensajes (6 intercambios)
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

// ===== LIMPIEZA AUTOMÁTICA DE HISTORIAL =====

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