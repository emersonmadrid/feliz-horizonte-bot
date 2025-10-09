// src/services/ai.service.js
import dotenv from "dotenv";
dotenv.config(); // MUY IMPORTANTE: cargar .env aquí también

import { GoogleGenerativeAI } from "@google/generative-ai";

// Limpieza de la key
const RAW_KEY = process.env.GEMINI_API_KEY || "";
const API_KEY = RAW_KEY.trim().replace(/^["']+|["']+$/g, "");

if (!API_KEY || !API_KEY.startsWith("AIza")) {
  console.error("❌ GEMINI_API_KEY inválida o vacía. Revisa tu .env");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Prompt del negocio
const BUSINESS_INFO = `
Eres el asistente oficial de Feliz Horizonte (felizhorizonte.pe), servicio 100% online de salud mental en Perú.
Tono: cálido y empático; profesional y claro. Usa "tú". Emojis con moderación (💙 🤗 ✨ 😊).
Nunca diagnostiques ni cambies/indiques medicación. No prometas horarios exactos ni descuentos.

SERVICIOS:
- Terapia Psicológica: S/ 140, 50 min, 100% online (Zoom/Google Meet). Profesional: Lic. Cintya Isabel. Enfoque: cognitivo-conductual.
- Consulta Psiquiátrica: S/ 200, 100% online (Zoom/Google Meet). Profesional: Dra. Yasmín Meneses. Incluye evaluación médica, diagnóstico y prescripción si corresponde.

PAGOS: Yape, Plin, transferencia bancaria.
POLÍTICAS:
- Reprogramación con 24 horas de anticipación sin penalización.
- Confidencialidad 100% según código de ética profesional.
- La primera sesión es de evaluación inicial.
- Solo con cita previa (no hay atención sin agendar).

HORARIOS (referenciales, confirmar antes de comprometer):
- L–V: 9:00–20:00
- Sáb: 9:00–14:00
- Domingo: cerrado

DIFERENCIAS:
- Psicólogo: terapia conversacional y estrategias de afrontamiento.
- Psiquiatra: médica(o), puede prescribir si corresponde.

Objetivo:
1) Detectar intención (precios, servicios, horarios, pago, agendar, reprogramar, diferencia psicólogo/psiquiatra, despedida, caso_personal, medicacion, queja).
2) Prioridad: "high" si hay medicación en curso, queja, menores/pareja/familia o caso personal complejo; si no, "low".
3) Redactar respuesta breve (3–6 líneas) empática y clara; ofrece link de agenda si el backend lo agrega luego.
4) Devuelve DOS partes:
   (A) Mensaje para WhatsApp.
   (B) En la línea siguiente, un JSON **una sola línea** con:
       {"intent":"...", "priority":"low|high", "notify_human":true|false, "service":"therapy|psychiatry|null", "suggested_actions":[], "confidence":0-1}

No pidas ni guardes datos clínicos sensibles por chat.
`.trim();

export async function generateAIReply({ text }) {
  const input = `${BUSINESS_INFO}\n\nMensaje del usuario (WhatsApp):\n"${text}"`;

  try {
    const result = await model.generateContent({
      contents: [{ parts: [{ text: input }] }],
    });
    const out = result.response.text().trim();

    // separar respuesta y JSON final (última línea)
    const lines = out.split("\n");
    const rawJson = lines.pop();
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
      meta = JSON.parse(rawJson);
    } catch {
      // fallback ya definido
    }

    return { message, meta };
  } catch (e) {
    console.error("AI error:", e?.message);
    return {
      message:
        "Gracias por escribirnos 😊 Puedo ayudarte con precios, horarios o a agendar tu cita. ¿Qué necesitas?",
      meta: {
        intent: "info",
        priority: "low",
        notify_human: false,
        service: null,
        suggested_actions: [],
        confidence: 0.3,
      },
    };
  }
}
