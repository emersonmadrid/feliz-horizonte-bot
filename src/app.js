// ─── Configuración base ──────────────────────────────────────────────
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import { generateAIReply } from "./services/ai.service.js";
import fs from "fs";

dotenv.config();
const app = express();
app.use(express.json());
app.use(bodyParser.json());

// ─── Constantes y Conexiones ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ⚠️ NO USES POLLING en Vercel — cambiamos a webhook mode
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const ADMIN = (process.env.TELEGRAM_ADMIN_CHAT_ID || "").toString();
const PANEL_CHAT_ID = (process.env.TELEGRAM_GROUP_CHAT_ID || "").toString();
const PANEL_TOPIC_ID = Number(process.env.TELEGRAM_TOPIC_ID_DEFAULT || 0);
let MODE = "smart";

const phoneToTopic = new Map();
const topicToPhone = new Map();
const MAP_FILE = "./topicMap.json";

// ─── Persistencia de topics ──────────────────────────────────────────
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
  }
}

// ─── Utilidades ─────────────────────────────────────────────────────
const emergencyKeywords = [
  "no quiero vivir", "quiero terminar con todo", "me quiero morir", "no vale la pena",
  "quiero hacerme daño", "suicid", "matarme", "quitarme la vida"
];
const crisisMessage = `Lamento profundamente que estés sintiendo esto. Tu vida es valiosa y hay ayuda disponible AHORA mismo.
🆘 LÍNEAS DE EMERGENCIA 24/7:
📞 Línea 113 - Salud Mental (gratuita, Perú)
📞 Emergencias: 116 o acude al hospital más cercano
No estás solo/a. 💙`;

function quickAnswers(text) {
  const t = text.toLowerCase();
  if (/(precio|cu[aá]nto|cuanto)/.test(t))
    return "Nuestros precios:\n• Terapia psicológica: S/ 140\n• Psiquiatría: S/ 200\n¿Te envío el enlace para agendar?";
  if (/horario|atienden|abren/.test(t))
    return "Horarios:\n• L–V: 9:00–20:00\n• Sáb: 9:00–14:00\nDom: cerrado.";
  if (/pago|pagar|yape|plin/.test(t))
    return "Aceptamos Yape, Plin y transferencia bancaria.";
  if (/psic[oó]log|psiquiatr/.test(t))
    return "Psicología: terapia conversacional.\nPsiquiatría: médica y farmacológica.";
  return null;
}

async function sendWhatsAppText(to, text) {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`(SIMULADO) WhatsApp → ${to}: ${text}`);
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
    const topic = await bot.createForumTopic(PANEL_CHAT_ID, `📱 ${phone}`);
    const id = topic.message_thread_id;
    topicToPhone.set(id, phone);
    phoneToTopic.set(phone, id);
    saveTopicMap();
    return id;
  } catch (e) {
    console.error("Error creando topic:", e.message);
    if (PANEL_TOPIC_ID) {
      phoneToTopic.set(phone, PANEL_TOPIC_ID);
      topicToPhone.set(PANEL_TOPIC_ID, phone);
      return PANEL_TOPIC_ID;
    }
    return null;
  }
}

async function notifyTelegram(title, lines, phone = null) {
  const body = `<b>${escapeHTML(title)}</b>\n${lines.map(escapeHTML).join("\n")}${
    phone ? `\n📱 <code>${escapeHTML(phone)}</code>` : ""
  }`;
  const topicId = phone ? await ensureTopicForPhone(phone) : PANEL_TOPIC_ID;
  if (topicId && PANEL_CHAT_ID)
    await bot.sendMessage(PANEL_CHAT_ID, body, { parse_mode: "HTML", message_thread_id: topicId });
  else if (ADMIN)
    await bot.sendMessage(ADMIN, body, { parse_mode: "HTML" });
}

async function saveMeta({ phone, emergency = false, required_human = false }) {
  try {
    await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: emergency ? "[emergency]" : "[msg]" }]);
  } catch (e) {
    console.error("Supabase error:", e.message);
  }
}

// ─── Telegram Webhook Handler ───────────────────────────────────────
app.post("/telegram/webhook", (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error("TG webhook error:", e.message);
    res.sendStatus(200);
  }
});

// ─── Comandos y Mensajes de Telegram ────────────────────────────────
bot.onText(/^\/modo(?:\s+(\w+))?$/i, (msg, m) => {
  const chatId = msg.chat.id.toString();
  if (chatId !== ADMIN) return bot.sendMessage(chatId, "No autorizado.");
  const next = (m[1] || "").toLowerCase();
  if (!next) return bot.sendMessage(chatId, `Modo actual: ${MODE}\nUsa: /modo auto | /modo manual | /modo smart`);
  if (!["auto", "manual", "smart"].includes(next)) return bot.sendMessage(chatId, "Modo inválido.");
  MODE = next;
  bot.sendMessage(chatId, `✅ Modo actualizado a: ${MODE}`);
});

bot.on("message", async (msg) => {
  try {
    if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
    if (!msg.message_thread_id || msg.from?.is_bot) return;

    const text = (msg.text || "").trim();
    if (!text || text.startsWith("/")) return;

    const topicId = msg.message_thread_id.toString();
    const phone = topicToPhone.get(topicId);
    if (!phone) return console.log("⚠️ Sin mapeo para topic", topicId);

    await sendWhatsAppText(phone, text);
    await saveMeta({ phone });
    console.log(`↪️ TG -> WA | topic ${topicId} → ${phone}: ${text}`);
  } catch (e) {
    console.error("TG->WA error:", e.message);
  }
});

// ─── WhatsApp Webhook ───────────────────────────────────────────────
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

    if (emergencyKeywords.some(k => text.toLowerCase().includes(k))) {
      await sendWhatsAppText(from, crisisMessage);
      await notifyTelegram("🚨 EMERGENCIA DETECTADA", [`"${text}"`, "⚠️ IA bloqueada."], from);
      await saveMeta({ phone: from, emergency: true, required_human: true });
      return res.sendStatus(200);
    }

    const quick = quickAnswers(text);
    if (quick) {
      await sendWhatsAppText(from, quick);
      await notifyTelegram("✅ Respondido automático (Quick)", [`"${text}"`], from);
      await saveMeta({ phone: from });
      return res.sendStatus(200);
    }

    const { message: aiMessage, meta } = await generateAIReply({ text });
    let shouldAutoReply = MODE === "auto" || (MODE === "smart" && !/(medicaci|pastilla|diagnost)/i.test(text));
    await notifyTelegram("🔔 NUEVO MENSAJE", [`🧭 Modo: ${MODE}`, `"${text}"`], from);
    await saveMeta({ phone: from, required_human: !shouldAutoReply });

    if (shouldAutoReply) {
      await sendWhatsAppText(from, aiMessage);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e.message);
    res.sendStatus(200);
  }
});

// ─── Inicialización ────────────────────────────────────────────────
loadTopicMap();
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => console.log(`🚀 Local en http://localhost:${PORT}`));
}
//export default (req, res) => app(req, res);
export default app;