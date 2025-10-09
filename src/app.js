// src/app.js
import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
// Si usas IA:
import { generateAIReply } from "./services/ai.service.js"; // deja este import si ya lo tienes

const app = express();
app.use(express.json());
app.use(bodyParser.json());

// ─── Conexiones ────────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ⚠️ IMPORTANTE: en Vercel no uses polling. Creamos el bot SIN polling.
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// IDs y config
const ADMIN = (process.env.TELEGRAM_ADMIN_CHAT_ID || "").toString();
const PANEL_CHAT_ID = (process.env.TELEGRAM_GROUP_CHAT_ID || "").toString(); // supergrupo con Topics
const PANEL_TOPIC_ID = Number(process.env.TELEGRAM_TOPIC_ID_DEFAULT || 0);   // topic por defecto (si quieres)
let MODE = "smart"; // auto | manual | smart

// ─── Mapeo número <-> topic ────────────────────────────────
const phoneToTopic = new Map(); // phone -> topicId
const topicToPhone = new Map(); // topicId -> phone
const MAP_FILE = "./topicMap.json";

function saveTopicMap() {
  const obj = {};
  for (const [topic, phone] of topicToPhone.entries()) obj[topic] = phone;
  fs.writeFileSync(MAP_FILE, JSON.stringify(obj, null, 2), "utf-8");
}
function loadTopicMap() {
  if (fs.existsSync(MAP_FILE)) {
    const data = JSON.parse(fs.readFileSync(MAP_FILE, "utf-8"));
    for (const [topic, phone] of Object.entries(data)) {
      topicToPhone.set(topic, phone);
      phoneToTopic.set(phone, topic);
    }
    console.log(`🔁 Mapa restaurado (${topicToPhone.size} topics).`);
  } else {
    console.log("📄 Sin mapa previo, iniciando vacío.");
  }
}

// ─── Utilidades ────────────────────────────────────────────
const emergencyKeywords = [
  "no quiero vivir", "quiero terminar con todo", "me quiero morir", "no vale la pena",
  "quiero hacerme daño", "pensamientos suicidas", "suicid", "matarme", "quitarme la vida"
];

const crisisMessage =
`Lamento profundamente que estés sintiendo esto. Tu vida es valiosa y hay ayuda disponible AHORA mismo.
🆘 LÍNEAS DE EMERGENCIA 24/7:
📞 Línea 113 - Salud Mental (gratuita, Perú)
📞 Emergencias: 116 o acude al hospital más cercano
Por favor, también contacta a un familiar o amigo cercano.
Cuando estés en un lugar más seguro, estamos aquí para apoyarte. No estás solo/a. 💙`;

function quickAnswers(text) {
  const t = (text || "").toLowerCase();
  if (/(precio|cu[aá]nto|cuanto)/.test(t))
    return "Precios:\n• Terapia psicológica: S/ 140 (50 min, online)\n• Consulta psiquiátrica: S/ 200 (online)\n¿Te envío el enlace para agendar?";
  if (/horario|atienden|abren|disponibilidad/.test(t))
    return "Horarios referenciales:\n• L–V: 9:00–20:00\n• Sáb: 9:00–14:00\nDomingo: cerrado. (Confirmamos disponibilidad exacta al agendar).";
  if (/pago|pagar|yape|plin|transfer/.test(t))
    return "Formas de pago: Yape, Plin y transferencia bancaria. Te pasamos los datos al confirmar tu cita.";
  if (/psic[oó]log|psiquiatr/.test(t))
    return "Psicología: terapia conversacional.\nPsiquiatría: médica, puede prescribir si corresponde.\n¿En qué quisieras apoyo?";
  return null;
}

async function sendWhatsAppText(to, text) {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`↩️ (SIMULADO) WhatsApp → ${to}: ${text}`);
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` } }
  );
}

function escapeHTML(s = "") {
  return s.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function ensureTopicForPhone(phone) {
  if (phoneToTopic.has(phone)) return phoneToTopic.get(phone);
  try {
    if (!PANEL_CHAT_ID) return null;
    const topic = await bot.createForumTopic(PANEL_CHAT_ID, `📱 ${phone}`);
    const id = topic.message_thread_id;
    topicToPhone.set(String(id), phone);
    phoneToTopic.set(phone, String(id));
    saveTopicMap();
    return String(id);
  } catch (e) {
    console.error("❌ Error creando topic:", e.message);
    if (PANEL_TOPIC_ID) {
      phoneToTopic.set(phone, String(PANEL_TOPIC_ID));
      topicToPhone.set(String(PANEL_TOPIC_ID), phone);
      return String(PANEL_TOPIC_ID);
    }
    return null;
  }
}

async function notifyTelegram(title, lines, phone = null) {
  const body =
    `<b>${escapeHTML(title)}</b>\n` +
    lines.map(escapeHTML).join("\n") +
    (phone ? `\n📱 <code>${escapeHTML(phone)}</code>` : "");
  const topicId = phone ? await ensureTopicForPhone(phone) : (PANEL_TOPIC_ID || null);

  if (PANEL_CHAT_ID && topicId) {
    await bot.sendMessage(PANEL_CHAT_ID, body, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      message_thread_id: Number(topicId),
    });
  } else if (ADMIN) {
    await bot.sendMessage(ADMIN, body, { parse_mode: "HTML", disable_web_page_preview: true });
  }
}

async function saveMeta({ phone, emergency = false, required_human = false }) {
  try {
    await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: emergency ? "[emergency]" : "[msg]" }]);
  } catch (e) {
    console.error("Supabase error:", e.message);
  }
}

// ─── Telegram: WEBHOOK (robusto) ───────────────────────────
// Acepta payloads reales y también pruebas "incompletas" (sin from/date)
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("📩 TG update:", JSON.stringify(update));

    // Si es un update real de Telegram (tiene message.date y message.from.id),
    // procesamos con la librería:
    const hasRealShape =
      !!update?.message?.date && !!update?.message?.from?.id && !!update?.message?.chat?.id;

    if (hasRealShape) {
      try { bot.processUpdate(update); } catch (e) { console.error("processUpdate error:", e.message); }
    } else {
      // Payload de prueba: responde al chat_id si viene
      const chatId = update?.message?.chat?.id;
      const text = (update?.message?.text || "").trim().toLowerCase();
      if (chatId && text === "ping") {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "pong (webhook OK)" })
        });
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("❌ TG webhook error:", e);
    return res.sendStatus(200);
  }
});

// ─── Lógica en Telegram (en modo webhook) ──────────────────
bot.onText(/^\/modo(?:\s+(\w+))?$/i, (msg, m) => {
  const chatId = msg.chat.id.toString();
  if (chatId !== ADMIN) return bot.sendMessage(chatId, "No autorizado.");
  const next = (m[1] || "").toLowerCase();
  if (!next) return bot.sendMessage(chatId, `Modo actual: ${MODE}\nUsa: /modo auto | /modo manual | /modo smart`);
  if (!["auto", "manual", "smart"].includes(next)) return bot.sendMessage(chatId, "Modo inválido.");
  MODE = next;
  bot.sendMessage(chatId, `✅ Modo actualizado a: ${MODE}`);
});

// Enviar desde topic (grupo) → WhatsApp
bot.on("message", async (msg) => {
  try {
    if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
    if (!msg.message_thread_id || msg.from?.is_bot) return;

    const text = (msg.text || "").trim();
    if (!text || text.startsWith("/")) return;

    const topicId = String(msg.message_thread_id);
    const phone = topicToPhone.get(topicId);
    if (!phone) return console.log("⚠️ Sin mapeo para topic", topicId);

    await sendWhatsAppText(phone, text);
    await saveMeta({ phone });
    await bot.sendMessage(PANEL_CHAT_ID, `📤 Enviado a <code>${escapeHTML(phone)}</code>`, {
      parse_mode: "HTML",
      message_thread_id: Number(topicId),
    });
  } catch (e) {
    console.error("TG->WA error:", e?.response?.data || e.message);
  }
});

// ─── WhatsApp Webhook ──────────────────────────────────────
app.get("/", (_req, res) => res.send("FH WhatsApp Bot ✅"));

app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
    return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = (msg.text?.body || "").trim();

    await ensureTopicForPhone(from);

    // 1) Emergencia
    const isEmergency = emergencyKeywords.some(k => text.toLowerCase().includes(k));
    if (isEmergency) {
      await sendWhatsAppText(from, crisisMessage);
      await notifyTelegram("🚨 EMERGENCIA DETECTADA", [`💬 "${text}"`, "⚠️ Protocolo enviado. IA bloqueada."], from);
      await saveMeta({ phone: from, emergency: true, required_human: true });
      return res.sendStatus(200);
    }

    // 2) Respuestas rápidas
    const quick = quickAnswers(text);
    if (quick) {
      await sendWhatsAppText(from, quick);
      await notifyTelegram("✅ Respondido automático (Quick)", [`💬 "${text}"`], from);
      await saveMeta({ phone: from, emergency: false, required_human: false });
      return res.sendStatus(200);
    }

    // 3) IA (si tienes implementado generateAIReply)
    let aiMessage = null, meta = null;
    try {
      const resAI = await generateAIReply({ text });
      aiMessage = resAI?.message || null;
      meta = resAI?.meta || null;
    } catch (e) {
      console.warn("IA fallback:", e.message);
    }

    // 4) Routing por modo + heurística
    let shouldAutoReply = false;
    if (MODE === "auto") shouldAutoReply = true;
    if (MODE === "manual") shouldAutoReply = false;
    if (MODE === "smart") {
      const needsHumanHeuristic = /(medicaci|pastilla|recetar|diagnost|menor|pareja|familia|queja|reclamo|factura)/i.test(text);
      const needsHumanAI = !!meta?.notify_human || meta?.priority === "high";
      shouldAutoReply = !(needsHumanHeuristic || needsHumanAI);
    }

    await notifyTelegram("🔔 NUEVO MENSAJE", [
      `🧭 Modo: ${MODE}`,
      `💬 "${text}"`,
      meta ? `🤖 IA: intent=${meta.intent} priority=${meta.priority} notify=${meta.notify_human}` : "🤖 IA: (sin meta)"
    ], from);

    await saveMeta({ phone: from, emergency: false, required_human: !shouldAutoReply });

    if (shouldAutoReply && (aiMessage || quick)) {
      await sendWhatsAppText(from, aiMessage || quick);
    } else if (!shouldAutoReply) {
      const topicId = phoneToTopic.get(from);
      if (topicId && PANEL_CHAT_ID) {
        await bot.sendMessage(PANEL_CHAT_ID, "✍️ Escribe tu respuesta en este mismo tema y la enviaré al WhatsApp del cliente.", {
          message_thread_id: Number(topicId),
        });
      } else if (ADMIN) {
        await bot.sendMessage(ADMIN, `✍️ Responde con:\n/enviar ${from} | (tu respuesta)`);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    res.sendStatus(200); // nunca romper
  }
});

// ─── Inicialización local ──────────────────────────────────
loadTopicMap();
if (process.env.VERCEL !== "1") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Local en http://localhost:${PORT}`));
}

// Handler serverless para Vercel
export default (req, res) => app(req, res);
