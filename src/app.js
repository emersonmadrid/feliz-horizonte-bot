// src/app.js
import dotenv from "dotenv";
import express from "express";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import { generateAIReply } from "./services/ai.service.js";

dotenv.config();
const app = express();
app.use(express.json());

const {
  PUBLIC_URL,
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
  VERCEL_ENV, // "production" | "preview" | "development"
} = process.env;

// --- Conexiones
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// IMPORTANTE: Solo usar webhook si estamos en producción de Vercel
const USE_WEBHOOK = VERCEL === "1" && VERCEL_ENV === "production" && PUBLIC_URL;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: !USE_WEBHOOK });

// Solo setear webhook en producción, y con mejor manejo de errores
if (USE_WEBHOOK) {
  // Asegurar que PUBLIC_URL no termine con /
  const baseUrl = PUBLIC_URL.replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/telegram/webhook`;
  
  console.log(`🔗 Configurando webhook en producción: ${webhookUrl}`);
  
  // Usar axios directamente para más control
  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    url: webhookUrl,
    drop_pending_updates: true,
    allowed_updates: ["message", "edited_message"]
  })
    .then((response) => {
      console.log(`✅ Webhook configurado exitosamente`);
      console.log(`📊 Respuesta:`, JSON.stringify(response.data, null, 2));
      
      // Verificar configuración con axios
      return axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    })
    .then((infoResponse) => {
      console.log(`📊 Webhook info:`, JSON.stringify(infoResponse.data, null, 2));
    })
    .catch((err) => {
      console.error(`❌ Error configurando webhook:`, err.response?.data || err.message);
      console.error(`⚠️ URL intentada: ${webhookUrl}`);
      console.error(`⚠️ Verifica TELEGRAM_BOT_TOKEN y PUBLIC_URL`);
    });
} else if (VERCEL === "1" && VERCEL_ENV !== "production") {
  console.log(`⚠️ Preview deployment detectado (${VERCEL_ENV}) - NO se configura webhook`);
  console.log(`ℹ️ Esta instancia NO procesará mensajes de Telegram`);
} else {
  console.log(`🔄 Modo local - usando polling`);
}

const ADMIN = (TELEGRAM_ADMIN_CHAT_ID || "").toString();
const PANEL_CHAT_ID = (TELEGRAM_GROUP_CHAT_ID || "").toString();
const PANEL_TOPIC_ID = Number(TELEGRAM_TOPIC_ID_DEFAULT || 0);

const phoneToTopic = new Map();
const topicToPhone = new Map();

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
    console.log(`📱 [SIMULADO] WhatsApp → ${to}: ${text}`);
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  console.log(`📤 Enviando WhatsApp a ${to}: ${text.substring(0, 50)}...`);
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );
  console.log(`✅ WhatsApp enviado exitosamente a ${to}`);
}

function escapeHTML(s = "") {
  return s.toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function ensureTopicForPhone(phone) {
  if (phoneToTopic.has(phone)) return phoneToTopic.get(phone);

  const { data: found } = await supabase
    .from("fh_topics")
    .select("topic_id")
    .eq("phone", phone)
    .maybeSingle();

  if (found?.topic_id) {
    phoneToTopic.set(phone, found.topic_id);
    topicToPhone.set(String(found.topic_id), phone);
    console.log(`✅ Topic encontrado en BD: ${phone} → ${found.topic_id}`);
    return found.topic_id;
  }

  try {
    const topic = await bot.createForumTopic(PANEL_CHAT_ID, `📱 ${phone}`);
    const topicId = String(topic.message_thread_id);
    phoneToTopic.set(phone, topicId);
    topicToPhone.set(topicId, phone);
    await supabase.from("fh_topics").upsert({ phone, topic_id: topicId });
    console.log(`✅ Topic creado: ${phone} → ${topicId}`);
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

  console.log(`📣 Notificando a Telegram: ${title} | Phone: ${phone || 'N/A'} | Topic: ${topicId}`);

  if (topicId && PANEL_CHAT_ID) {
    try {
      await bot.sendMessage(PANEL_CHAT_ID, body, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        message_thread_id: topicId,
      });
      console.log(`✅ Mensaje enviado exitosamente al topic ${topicId}`);
    } catch (err) {
      console.error(`❌ Error enviando a topic ${topicId}:`, err.message);
      
      // Si el topic no existe, intentar recrearlo
      if (err.message.includes("thread not found") || err.message.includes("message thread not found")) {
        console.log(`🔄 Topic ${topicId} no existe, recreando...`);
        
        try {
          // Eliminar el registro viejo de la BD
          if (phone) {
            await supabase.from("fh_topics").delete().eq("phone", phone);
            phoneToTopic.delete(phone);
            topicToPhone.delete(topicId);
            console.log(`🗑️ Registro viejo eliminado de BD para ${phone}`);
          }
          
          // Crear nuevo topic
          const newTopicId = await ensureTopicForPhone(phone);
          console.log(`✅ Nuevo topic creado: ${newTopicId}`);
          
          // Reintentar envío con el nuevo topic
          await bot.sendMessage(PANEL_CHAT_ID, body, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            message_thread_id: newTopicId,
          });
          console.log(`✅ Mensaje enviado al nuevo topic ${newTopicId}`);
        } catch (retryErr) {
          console.error(`❌ Error recreando topic:`, retryErr.message);
          
          // Último recurso: enviar al admin o al topic por defecto
          if (PANEL_TOPIC_ID) {
            await bot.sendMessage(PANEL_CHAT_ID, body, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              message_thread_id: PANEL_TOPIC_ID,
            });
            console.log(`✅ Mensaje enviado al topic por defecto ${PANEL_TOPIC_ID}`);
          } else if (ADMIN) {
            await bot.sendMessage(ADMIN, body, { parse_mode: "HTML" });
            console.log(`✅ Mensaje enviado al admin`);
          }
        }
      } else {
        // Otro tipo de error, intentar enviar al admin
        if (ADMIN) {
          await bot.sendMessage(ADMIN, body, { parse_mode: "HTML" });
          console.log(`✅ Mensaje enviado al admin por error en topic`);
        }
      }
    }
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
    console.error("❌ Supabase error:", e.message);
  }
}

// ---- TG comandos
let MODE = "smart";

bot.onText(/^\/modo(?:\s+(\w+))?$/i, (msg, m) => {
  console.log(`🤖 Comando /modo recibido de ${msg.chat.id}`);
  if (String(msg.chat.id) !== ADMIN) return bot.sendMessage(msg.chat.id, "No autorizado.");
  const next = (m[1] || "").toLowerCase();
  if (!next) return bot.sendMessage(msg.chat.id, `Modo actual: ${MODE}\nUsa: /modo auto | /modo manual | /modo smart`);
  if (!["auto","manual","smart"].includes(next)) return bot.sendMessage(msg.chat.id, "Modo inválido.");
  MODE = next;
  bot.sendMessage(msg.chat.id, `✅ Modo actualizado a: ${MODE}`);
});

bot.onText(/^\/enviar\s+(.+?)\s*\|\s*([\s\S]+)$/i, async (msg, match) => {
  console.log(`📨 Comando /enviar recibido de ${msg.chat.id}`);
  if (String(msg.chat.id) !== ADMIN) return bot.sendMessage(msg.chat.id, "No autorizado.");
  const to = match[1].trim();
  const text = match[2].trim();
  try {
    await sendWhatsAppText(to, text);
    await supabase.from("mensajes").insert([{ chat_id: to, mensaje: "[human]" }]);
    bot.sendMessage(msg.chat.id, `📤 Enviado a ${to}:\n"${text}"`);
  } catch (e) {
    console.error("❌ Error en /enviar:", e.message);
    bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ---- TG → WA (desde topic) - SOLO EN POLLING (local)
if (!USE_WEBHOOK) {
  bot.on("message", async (msg) => {
    try {
      if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
      if (!msg.message_thread_id) return;
      if (msg.from?.is_bot) return;

      const text = (msg.text || "").trim();
      if (!text || text.startsWith("/")) return;

      const topicId = String(msg.message_thread_id);
      console.log(`💬 Mensaje en topic ${topicId}: "${text.substring(0, 50)}..."`);
      
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
      console.log(`✅ TG → WA | topic ${topicId} → ${phone}`);

      await bot.sendMessage(PANEL_CHAT_ID, `📤 Enviado a <code>${escapeHTML(phone)}</code>`, {
        parse_mode: "HTML",
        message_thread_id: msg.message_thread_id,
      });
    } catch (e) {
      console.error("❌ TG→WA error:", e?.response?.data || e.message);
    }
  });
}

// ---- HTTP ENDPOINTS

app.get("/", (_req, res) => {
  res.json({
    status: "✅ FH WhatsApp Bot activo",
    mode: USE_WEBHOOK ? "webhook" : "polling",
    env: VERCEL_ENV || "local",
    endpoints: {
      telegram: "/telegram/webhook",
      whatsapp: "/webhook/whatsapp",
    }
  });
});

// Endpoint temporal para limpiar topics obsoletos
app.post("/admin/clean-topic", async (req, res) => {
  const { admin_key, phone } = req.body;
  
  if (admin_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: "No autorizado" });
  }

  try {
    const { data, error } = await supabase
      .from("fh_topics")
      .delete()
      .eq("phone", phone);
    
    if (error) throw error;
    
    // Limpiar caché
    const oldTopic = phoneToTopic.get(phone);
    phoneToTopic.delete(phone);
    if (oldTopic) topicToPhone.delete(oldTopic);
    
    return res.json({
      success: true,
      message: `Topic para ${phone} eliminado de BD`,
      data
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
});

// Endpoint para listar todos los topics
app.get("/admin/list-topics", async (req, res) => {
  const { admin_key } = req.query;
  
  if (admin_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: "No autorizado" });
  }

  try {
    const { data, error } = await supabase
      .from("fh_topics")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    
    return res.json({
      total: data.length,
      topics: data
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
});

// Webhook de Telegram
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    const msg = update?.message;
    
    console.log("📥 TELEGRAM WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(update, null, 2));

    if (!msg) {
      console.log("⚠️ Telegram webhook sin mensaje (puede ser edit, callback, etc)");
      return res.sendStatus(200);
    }

    const chatId = String(msg.chat?.id);
    const text = (msg.text || "").trim();
    const topicId = msg.message_thread_id ? String(msg.message_thread_id) : null;
    const fromUser = msg.from?.username || msg.from?.first_name || "Unknown";
    const isBot = msg.from?.is_bot || false;

    console.log(`📨 TELEGRAM MESSAGE DETAILS:`);
    console.log(`   Chat ID: ${chatId}`);
    console.log(`   Topic ID: ${topicId}`);
    console.log(`   From: ${fromUser} (bot: ${isBot})`);
    console.log(`   Text: "${text}"`);
    console.log(`   Panel Chat ID: ${PANEL_CHAT_ID}`);

    // Ignorar mensajes de bots
    if (isBot) {
      console.log("⚠️ Mensaje de bot, ignorando");
      return res.sendStatus(200);
    }

    // Procesar comandos globalmente (no solo en el panel)
    if (text.startsWith("/")) {
      console.log(`🤖 Comando detectado: ${text}`);
      // Los comandos se procesan con bot.onText, solo loguear aquí
      return res.sendStatus(200);
    }

    // Si es del panel y tiene topic → reenviar a WhatsApp
    if (chatId === PANEL_CHAT_ID && topicId && text) {
      console.log(`✅ Mensaje del panel en topic ${topicId}, procesando...`);
      
      let phone = topicToPhone.get(topicId);
      
      if (!phone) {
        console.log(`🔍 Buscando teléfono para topic ${topicId} en Supabase...`);
        const { data: row } = await supabase
          .from("fh_topics")
          .select("phone")
          .eq("topic_id", topicId)
          .maybeSingle();
        
        if (row?.phone) {
          phone = row.phone;
          topicToPhone.set(topicId, phone);
          phoneToTopic.set(phone, topicId);
          console.log(`✅ Teléfono encontrado en BD: ${phone}`);
        }
      } else {
        console.log(`✅ Teléfono encontrado en caché: ${phone}`);
      }

      if (phone) {
        console.log(`📤 REENVIANDO A WHATSAPP:`);
        console.log(`   Desde topic: ${topicId}`);
        console.log(`   Hacia número: ${phone}`);
        console.log(`   Mensaje: "${text}"`);
        
        await sendWhatsAppText(phone, text);
        await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);
        
        console.log(`✅ Mensaje reenviado exitosamente`);
        
        await bot.sendMessage(PANEL_CHAT_ID, `📤 Enviado a <code>${escapeHTML(phone)}</code>`, {
          parse_mode: "HTML",
          message_thread_id: topicId,
        });
      } else {
        console.error(`❌ NO SE ENCONTRÓ TELÉFONO para topic ${topicId}`);
        console.log(`   Verifica que el topic esté en la tabla fh_topics`);
        
        // Notificar en el mismo topic
        await bot.sendMessage(PANEL_CHAT_ID, 
          `⚠️ Error: No se encontró el número de teléfono asociado a este topic.\nTopic ID: ${topicId}`, 
          { message_thread_id: topicId }
        );
      }
    } else {
      console.log(`ℹ️ Mensaje no procesado:`);
      console.log(`   Es del panel? ${chatId === PANEL_CHAT_ID}`);
      console.log(`   Tiene topic? ${!!topicId}`);
      console.log(`   Tiene texto? ${!!text}`);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("❌ TG WEBHOOK ERROR:");
    console.error(e);
    console.error(e.stack);
    return res.sendStatus(200);
  }
});

// Verificación de webhook de WhatsApp (GET)
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  console.log(`🔍 WhatsApp webhook verification | mode: ${mode} | token: ${token}`);
  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verificado");
    return res.status(200).send(challenge);
  }
  console.log("❌ WhatsApp webhook verification failed");
  return res.sendStatus(403);
});

// WhatsApp (POST)
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    console.log("📥 WHATSAPP WEBHOOK:", JSON.stringify(req.body, null, 2));
    
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    
    if (!msg) {
      console.log("⚠️ WhatsApp webhook sin mensaje");
      return res.sendStatus(200);
    }

    const from = msg.from;
    const text = (msg.text?.body || "").trim();

    console.log(`💬 WhatsApp de ${from}: "${text}"`);

    await ensureTopicForPhone(from);

    // Emergencia
    const isEmergency = emergencyKeywords.some(k => text.toLowerCase().includes(k));
    if (isEmergency) {
      console.log(`🚨 EMERGENCIA detectada de ${from}`);
      await sendWhatsAppText(from, crisisMessage);
      await notifyTelegram("🚨 EMERGENCIA DETECTADA", [`💬 "${text}"`, "⚠️ Protocolo enviado. IA bloqueada."], from);
      await saveMeta({ phone: from, emergency: true, required_human: true });
      return res.sendStatus(200);
    }

    // Quick answers
    const quick = quickAnswers(text);
    if (quick) {
      console.log(`⚡ Quick answer para ${from}`);
      await sendWhatsAppText(from, quick);
      await notifyTelegram("✅ Respondido automático (Quick)", [`💬 "${text}"`], from);
      await saveMeta({ phone: from });
      return res.sendStatus(200);
    }

    // IA (Gemini)
    console.log(`🤖 Consultando IA para mensaje de ${from}`);
    const { message: aiMessage, meta } = await generateAIReply({ text });
    console.log(`🤖 IA respondió | intent: ${meta?.intent} | priority: ${meta?.priority} | notify: ${meta?.notify_human}`);

    // Notifica a Telegram
    await notifyTelegram("🔔 NUEVO MENSAJE", [
      `💬 "${text}"`,
      `🤖 IA: intent=${meta?.intent} priority=${meta?.priority} notify=${meta?.notify_human}`,
    ], from);

    // Decide si auto-responder
    const shouldAutoReply = !meta?.notify_human;

    await saveMeta({ phone: from, required_human: !shouldAutoReply });

    if (shouldAutoReply) {
      console.log(`🤖 Auto-respondiendo a ${from}`);
      await sendWhatsAppText(from, aiMessage);
    } else {
      console.log(`👤 Requiere respuesta humana para ${from}`);
      const topicId = await ensureTopicForPhone(from);
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
    console.error("❌ Webhook error:", e?.response?.data || e.message);
    res.sendStatus(200);
  }
});

// Export para Vercel / local
if (VERCEL !== "1") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🚀 Local http://localhost:${port}`));
}

export default (req, res) => app(req, res);