// src/app.js
import dotenv from "dotenv";
import express from "express";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();
const app = express();
app.use(express.json());

const {
  PUBLIC_URL,                 // p.ej. https://feliz-horizonte-bot.vercel.app
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ADMIN_CHAT_ID,
  TELEGRAM_GROUP_CHAT_ID,
  TELEGRAM_TOPIC_ID_DEFAULT,
  SUPABASE_URL,
  SUPABASE_KEY,
  WHATSAPP_API_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  VERCEL,
} = process.env;

// --- Conexiones
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Si hay PUBLIC_URL => webhook; si no => polling (local)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: !PUBLIC_URL });
if (PUBLIC_URL) {
  bot.setWebHook(`${PUBLIC_URL}/telegram/webhook`).catch(() => {});
}

const ADMIN = (TELEGRAM_ADMIN_CHAT_ID || "").toString();
const PANEL_CHAT_ID = (TELEGRAM_GROUP_CHAT_ID || "").toString();
const PANEL_TOPIC_ID = Number(TELEGRAM_TOPIC_ID_DEFAULT || 0);

// Cache en memoria por ejecución
const phoneToTopic = new Map(); // phone -> topicId
const topicToPhone = new Map(); // topicId -> phone

// ---- Utilidades
const emergencyKeywords = [
  "no quiero vivir","quiero terminar con todo","me quiero morir","no vale la pena",
  "quiero hacerme daño","pensamientos suicidas","suicid","matarme","quitarme la vida"
];
const crisisMessage =
  "Lamento profundamente que estés sintiendo esto... 🆘 Línea 113 (Perú) • Emergencias 116 • Acude al hospital más cercano.";

function quickAnswers(text) {
  const t = (text || "").toLowerCase();
  if (/(precio|cu[aá]nto|cuanto)/.test(t)) {
    return "Nuestros precios:\n• Terapia psicológica: S/ 140 (50 min, online)\n• Consulta psiquiátrica: S/ 200 (online)\n¿Te envío el enlace para agendar?";
  }
  if (/horario|atienden|atenci[oó]n|abren|disponibilidad/.test(t)) {
    return "Horarios:\n• L–V: 9:00–20:00\n• Sáb: 9:00–14:00\nDomingo cerrado (confirmamos al agendar).";
  }
  if (/pago|pagar|yape|plin|transfer/.test(t)) {
    return "Formas de pago: Yape, Plin y transferencia. Pasamos los datos al confirmar la cita.";
  }
  if (/psic[oó]log|psiquiatr/.test(t)) {
    return "Psicología: terapia conversacional.\nPsiquiatría: evaluación médica y prescripción si corresponde.\n¿En qué quisieras apoyo?";
  }
  return null;
}

async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`(SIMULADO) WhatsApp → ${to}: ${text}`);
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );
}

function escapeHTML(s = "") {
  return s.toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function ensureTopicForPhone(phone) {
  if (phoneToTopic.has(phone)) return phoneToTopic.get(phone);

  // 1) buscar en Supabase
  const { data: found } = await supabase
    .from("fh_topics")
    .select("topic_id")
    .eq("phone", phone)
    .maybeSingle();

  if (found?.topic_id) {
    phoneToTopic.set(phone, found.topic_id);
    topicToPhone.set(String(found.topic_id), phone);
    return found.topic_id;
  }

  // 2) crear topic
  try {
    const topic = await bot.createForumTopic(PANEL_CHAT_ID, `📱 ${phone}`);
    const topicId = String(topic.message_thread_id);
    phoneToTopic.set(phone, topicId);
    topicToPhone.set(topicId, phone);
    await supabase.from("fh_topics").upsert({ phone, topic_id: topicId });
    return topicId;
  } catch (err) {
    console.error("❌ Error creando topic:", err?.message);
    if (PANEL_TOPIC_ID) {
      phoneToTopic.set(phone, String(PANEL_TOPIC_ID));
      topicToPhone.set(String(PANEL_TOPIC_ID), phone);
      return String(PANEL_TOPIC_ID);
    }
    return null;
  }
}

async function notifyTelegram(title, lines, phone = null) {
  const body = `<b>${escapeHTML(title)}</b>\n${lines.map(escapeHTML).join("\n")}${
    phone ? `\n📱 <code>${escapeHTML(phone)}</code>` : ""
  }`;
  const topicId = phone ? await ensureTopicForPhone(phone) : PANEL_TOPIC_ID;

  if (topicId && PANEL_CHAT_ID) {
    await bot.sendMessage(PANEL_CHAT_ID, body, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      message_thread_id: topicId,
    });
  } else if (ADMIN) {
    await bot.sendMessage(ADMIN, body, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

async function saveMeta({ phone, emergency = false, required_human = false }) {
  try {
    await supabase.from("mensajes").insert([
      { chat_id: phone, mensaje: emergency ? "[emergency]" : "[msg]" },
    ]);
  } catch (e) {
    console.error("Supabase error:", e.message);
  }
}

// ---- TG comandos
let MODE = "smart";

bot.onText(/^\/modo(?:\s+(\w+))?$/i, (msg, m) => {
  if (String(msg.chat.id) !== ADMIN) return bot.sendMessage(msg.chat.id, "No autorizado.");
  const next = (m[1] || "").toLowerCase();
  if (!next) return bot.sendMessage(msg.chat.id, `Modo actual: ${MODE}\nUsa: /modo auto | /modo manual | /modo smart`);
  if (!["auto","manual","smart"].includes(next)) return bot.sendMessage(msg.chat.id, "Modo inválido.");
  MODE = next;
  bot.sendMessage(msg.chat.id, `✅ Modo actualizado a: ${MODE}`);
});

bot.onText(/^\/enviar\s+(.+?)\s*\|\s*([\s\S]+)$/i, async (msg, match) => {
  if (String(msg.chat.id) !== ADMIN) return bot.sendMessage(msg.chat.id, "No autorizado.");
  const to = match[1].trim();
  const text = match[2].trim();
  try {
    await sendWhatsAppText(to, text);
    await supabase.from("mensajes").insert([{ chat_id: to, mensaje: "[human]" }]);
    bot.sendMessage(msg.chat.id, `📤 Enviado a ${to}:\n"${text}"`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ---- TG → WA (desde topic)
bot.on("message", async (msg) => {
  try {
    if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
    if (!msg.message_thread_id) return;
    if (msg.from?.is_bot) return;

    const text = (msg.text || "").trim();
    if (!text || text.startsWith("/")) return;

    const topicId = String(msg.message_thread_id);
    let phone = topicToPhone.get(topicId);
    if (!phone) {
      const { data: row } = await supabase
        .from("fh_topics")
        .select("phone")
        .eq("topic_id", topicId)
        .maybeSingle();
      if (row?.phone) {
        phone = row.phone;
        topicToPhone.set(topicId, phone);
        phoneToTopic.set(phone, topicId);
      }
    }
    if (!phone) {
      console.log("⚠️ Sin mapeo para topic", topicId);
      return;
    }

    await sendWhatsAppText(phone, text);
    await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);
    console.log(`↪️ TG -> WA | topic ${topicId} → ${phone} : ${text}`);

    await bot.sendMessage(PANEL_CHAT_ID, `📤 Enviado a <code>${escapeHTML(phone)}</code>`, {
      parse_mode: "HTML",
      message_thread_id: msg.message_thread_id,
    });
  } catch (e) {
    console.error("TG->WA error:", e?.response?.data || e.message);
  }
});

// LOG GLOBAL (DEBUG): quítalo luego
bot.on("message", (m) => {
  console.log("ALL ▶", m.chat.id, m.message_thread_id, JSON.stringify(m.text || m.caption || m, null, 2));
});


// ---- HTTP
app.post("/telegram/webhook", (req, res) => {
  try {
    bot.processUpdate(req.body);                     // procesa el update recibido
    console.log("TG webhook ▶", req.body?.message?.text || "(sin texto)");
    return res.sendStatus(200);
  } catch (e) {
    console.error("TG webhook error:", e);
    return res.sendStatus(200);
  }
});

app.get("/", (_req, res) => res.send("FH WhatsApp Bot ✅"));

// Verificación de webhook de WhatsApp (GET)
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// WhatsApp (POST) — soporta simulador
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = (msg.text?.body || "").trim();

    await ensureTopicForPhone(from);

    const isEmergency = emergencyKeywords.some(k => text.toLowerCase().includes(k));
    if (isEmergency) {
      await sendWhatsAppText(from, crisisMessage);
      await notifyTelegram("🚨 EMERGENCIA DETECTADA", [`💬 "${text}"`, "⚠️ Protocolo enviado. IA bloqueada."], from);
      await saveMeta({ phone: from, emergency: true, required_human: true });
      return res.sendStatus(200);
    }

    const quick = quickAnswers(text);
    if (quick) {
      await sendWhatsAppText(from, quick);
      await notifyTelegram("✅ Respondido automático (Quick)", [`💬 "${text}"`], from);
      await saveMeta({ phone: from });
      return res.sendStatus(200);
    }

    await notifyTelegram("🔔 NUEVO MENSAJE", [`💬 "${text}"`, "🤖 IA: desactivada en demo", "🧑‍⚕️ Requiere humano"], from);
    await saveMeta({ phone: from, required_human: true });
    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    res.sendStatus(200);
  }
});

// Export para Vercel / local
if (VERCEL !== "1") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Local http://localhost:${port}`));
}
export default (req, res) => app(req, res);
