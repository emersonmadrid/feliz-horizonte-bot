// src/app.js
import dotenv from "dotenv";
import express from "express";
//import bodyParser from "body-parser";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import { generateAIReply } from "./services/ai.service.js";

dotenv.config();
const app = express();
app.use(express.json()); // << si ya lo tienes, no lo dupliques

//app.use(bodyParser.json());



const PORT = process.env.PORT || 3000;

// ---- conexiones
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
//const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN); // modo webhook
// IDs de Telegram
const ADMIN = (process.env.TELEGRAM_ADMIN_CHAT_ID || "").toString();
const PANEL_CHAT_ID = (process.env.TELEGRAM_GROUP_CHAT_ID || "").toString(); // supergrupo con Topics
const PANEL_TOPIC_ID = Number(process.env.TELEGRAM_TOPIC_ID_DEFAULT || 0);   // opcional: topic por defecto

// ---- estado
let MODE = "smart"; // auto | manual | smart

// ---- mapeos para topic por número
const phoneToTopic = new Map(); // phone -> topicId
const topicToPhone = new Map(); // topicId -> phone

import fs from "fs";

const MAP_FILE = "./topicMap.json";

// 🔹 Guarda el mapa de topics en el disco
function saveTopicMap() {
    const obj = {};
    for (const [topic, phone] of topicToPhone.entries()) {
        obj[topic] = phone;
    }
    fs.writeFileSync(MAP_FILE, JSON.stringify(obj, null, 2), "utf-8");
    console.log("💾 Mapa de topics guardado.");
}

// 🔹 Carga el mapa de topics al iniciar
function loadTopicMap() {
    if (fs.existsSync(MAP_FILE)) {
        const data = JSON.parse(fs.readFileSync(MAP_FILE, "utf-8"));
        for (const [topic, phone] of Object.entries(data)) {
            topicToPhone.set(topic, phone);
            phoneToTopic.set(phone, topic);
        }
        console.log(`🔁 Mapa restaurado (${topicToPhone.size} topics cargados).`);
    } else {
        console.log("📄 No hay mapa previo, iniciando vacío.");
    }
}


// ---- utilidades
const emergencyKeywords = [
    "no quiero vivir", "quiero terminar con todo", "me quiero morir", "no vale la pena",
    "quiero hacerme daño", "pensamientos suicidas", "suicid", "matarme", "quitarme la vida"
];

const crisisMessage =
    `Lamento profundamente que estés sintiendo esto. Tu vida es valiosa y hay ayuda disponible AHORA mismo.
🆘 LÍNEAS DE EMERGENCIA 24/7:
📞 Línea 113 - Salud Mental (gratuita, Perú)
📞 Emergencias: 116 o acude al hospital más cercano
Por favor, también contacta a un familiar de confianza o amigo cercano.
Cuando estés en un lugar más seguro, estaremos aquí para apoyarte en tu proceso. No estás solo/a. 💙`;

function quickAnswers(text) {
    const t = text.toLowerCase();
    if (/(precio|cu[aá]nto|cuanto)/.test(t)) {
        return "Nuestros precios:\n• Terapia psicológica: S/ 140 (50 min, online)\n• Consulta psiquiátrica: S/ 200 (online)\n¿Te envío el enlace para agendar?";
    }
    if (/horario|atienden|atenci[oó]n|abren|disponibilidad/.test(t)) {
        return "Horarios referenciales:\n• L–V: 9:00–20:00\n• Sáb: 9:00–14:00\nDomingo: cerrado. (Confirmamos disponibilidad exacta al agendar).";
    }
    if (/pago|pagar|yape|plin|transfer/.test(t)) {
        return "Formas de pago: Yape, Plin y transferencia bancaria. Te pasamos los datos al confirmar tu cita.";
    }
    if (/psic[oó]log|psiquiatr/.test(t)) {
        return "Psicología: terapia conversacional y estrategias de afrontamiento.\nPsiquiatría: médica, puede prescribir si corresponde.\n¿En qué quisieras apoyo?";
    }
    return null;
}

async function sendWhatsAppText(to, text) {
    if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
        console.log(`↩️ (SIMULADO) WhatsApp → ${to}: ${text}`);
        return;
    }
    const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    await axios.post(url, { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
        { headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` } });
}

// ---- helpers HTML
function escapeHTML(s = "") {
    return s
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Crea/usa topic para un número y guarda el mapeo
async function ensureTopicForPhone(phone) {
    // ya existe
    if (phoneToTopic.has(phone)) return phoneToTopic.get(phone);

    try {
        const title = `📱 ${phone}`;
        const topic = await bot.createForumTopic(PANEL_CHAT_ID, title);
        const topicId = topic.message_thread_id;

        // 🟢 corregido
        topicToPhone.set(topicId, phone);
        phoneToTopic.set(phone, topicId);

        saveTopicMap();
        return topicId;
    } catch (err) {
        console.error("❌ Error creando topic:", err?.message);
        if (PANEL_TOPIC_ID) {
            phoneToTopic.set(phone, PANEL_TOPIC_ID);
            topicToPhone.set(PANEL_TOPIC_ID, phone);
            return PANEL_TOPIC_ID;
        }
        return null;
    }
}

async function notifyTelegram(title, lines, phone = null) {
    const body =
        `<b>${escapeHTML(title)}</b>\n` +
        lines.map(escapeHTML).join("\n") +
        (phone ? `\n📱 <code>${escapeHTML(phone)}</code>` : "");

    // publicar en el topic del número
    const topicId = phone ? await ensureTopicForPhone(phone) : PANEL_TOPIC_ID;

    if (topicId && PANEL_CHAT_ID) {
        await bot.sendMessage(PANEL_CHAT_ID, body, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            message_thread_id: topicId,
        });
        return;
    }

    // fallback: DM al admin
    if (ADMIN) {
        await bot.sendMessage(ADMIN, body, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
        });
    }
}

async function saveMeta({ phone, emergency = false, required_human = false }) {
    try { await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: emergency ? "[emergency]" : "[msg]" }]); }
    catch (e) { console.error("Supabase error:", e.message); }
}

// ---- comandos telegram mínimos
bot.onText(/^\/modo(?:\s+(\w+))?$/i, (msg, m) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN) return bot.sendMessage(chatId, "No autorizado.");
    const next = (m[1] || "").toLowerCase();
    if (!next) return bot.sendMessage(chatId, `Modo actual: ${MODE}\nUsa: /modo auto | /modo manual | /modo smart`);
    if (!["auto", "manual", "smart"].includes(next)) return bot.sendMessage(chatId, "Modo inválido.");
    MODE = next; bot.sendMessage(chatId, `✅ Modo actualizado a: ${MODE}`);
});

bot.onText(/^\/enviar\s+(.+?)\s*\|\s*([\s\S]+)$/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN) return bot.sendMessage(chatId, "No autorizado.");
    const to = match[1].trim(); const text = match[2].trim();
    try {
        await sendWhatsAppText(to, text);
        await supabase.from("mensajes").insert([{ chat_id: to, mensaje: "[human]" }]);
        bot.sendMessage(chatId, `📤 Enviado a ${to}:\n"${text}"`);
    } catch (e) { bot.sendMessage(chatId, `❌ Error: ${e.message}`); }
});

// *** RESPUESTA DESDE EL TOPIC → WHATSAPP ***
bot.on("message", async (msg) => {
  try {
    // Solo mensajes del panel y que pertenezcan a un topic
    if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
    if (!msg.message_thread_id) return; // <-- usa message_thread_id en lugar de is_topic_message
    if (msg.from?.is_bot) return;       // ignora mensajes del propio bot

    const text = (msg.text || "").trim();
    if (!text || text.startsWith("/")) return;

    const topicId = msg.message_thread_id.toString();
    const phone = topicToPhone.get(topicId);
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
    await bot.sendMessage(PANEL_CHAT_ID, `❌ Error enviando: <code>${escapeHTML(e.message)}</code>`, {
      parse_mode: "HTML",
      message_thread_id: msg.message_thread_id,
    });
  }
});

// ---- http
app.get("/", (_req, res) => res.send("FH WhatsApp Bot ✅"));

app.get("/webhook/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.sendStatus(403);
});

app.post('/telegram/webhook', (req, res) => {
  console.log('TG webhook hit:', JSON.stringify(req.body));
  res.sendStatus(200); // Telegram exige 200
});


// ---- webhook principal
app.post("/webhook/whatsapp", async (req, res) => {
    try {
        const change = req.body?.entry?.[0]?.changes?.[0]?.value;
        const msg = change?.messages?.[0];
        if (!msg) return res.sendStatus(200);

        const from = msg.from;                      // "5198..."
        const text = (msg.text?.body || "").trim(); // mensaje

        // garantizar mapeo del topic para este número
        await ensureTopicForPhone(from);

        // 1) Emergencia
        const isEmergency = emergencyKeywords.some(k => text.toLowerCase().includes(k));
        if (isEmergency) {
            await sendWhatsAppText(from, crisisMessage);
            await notifyTelegram("🚨 EMERGENCIA DETECTADA", [`💬 "${text}"`, "⚠️ Protocolo enviado. IA bloqueada."], from);
            await saveMeta({ phone: from, emergency: true, required_human: true });
            return res.sendStatus(200);
        }

        // 2) Quick answers (sin IA) — asegura respuesta para precio/horarios/pagos
        const quick = quickAnswers(text);
        if (quick) {
            await sendWhatsAppText(from, quick);
            await notifyTelegram("✅ Respondido automático (Quick)", [`💬 "${text}"`], from);
            await saveMeta({ phone: from, emergency: false, required_human: false });
            return res.sendStatus(200);
        }

        // 3) IA (Gemini 2.5 Flash)
        const { message: aiMessage, meta } = await generateAIReply({ text });

        // 4) Routing por modo + señal de IA
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
            meta ? `🤖 IA: intent=${meta.intent} priority=${meta.priority} notify=${meta.notify_human}` : "🤖 IA: fallback",
            shouldAutoReply ? "✅ Auto-respuesta" : "🧑‍⚕️ Requiere humano"
        ], from);

        await saveMeta({ phone: from, emergency: false, required_human: !shouldAutoReply });

        if (shouldAutoReply) {
            let final = aiMessage;
            if (meta?.service === "therapy" && process.env.CALENDLY_THERAPY_URL) {
                final += `\n\nAgenda aquí: ${process.env.CALENDLY_THERAPY_URL}`;
            }
            if (meta?.service === "psychiatry" && process.env.CALENDLY_PSYCHIATRY_URL) {
                final += `\n\nAgenda aquí: ${process.env.CALENDLY_PSYCHIATRY_URL}`;
            }
            await sendWhatsAppText(from, final);
        } else {
            // guidance para responder desde el topic sin comandos
            const topicId = phoneToTopic.get(from);
            if (topicId && PANEL_CHAT_ID) {
                await bot.sendMessage(PANEL_CHAT_ID, "✍️ Escribe tu respuesta en este mismo tema y la enviaré al WhatsApp del cliente.", {
                    message_thread_id: topicId,
                });
            } else if (ADMIN) {
                await bot.sendMessage(ADMIN, `✍️ Responde con:\n/enviar ${from} | (tu respuesta)`);
            }
        }

        res.sendStatus(200);
    } catch (e) {
        console.error("Webhook error:", e?.response?.data || e.message);
        res.sendStatus(200);
    }
});

loadTopicMap();
//app.listen(PORT, () => console.log(`🚀 FH bot en http://localhost:${PORT}`));


// ---- IMPORTANTE para Vercel ----
// Exporta la app como handler (Express es compatible)
// Si corres local, habilita el listener
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Local en http://localhost:${PORT}`));
}
export default (req, res) => app(req, res);
