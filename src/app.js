// src/app.js - VERSIÓN CORREGIDA
import dotenv from "dotenv";
import express from "express";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import { generateAIReply } from "./services/ai.service.js";

dotenv.config();
const app = express();
app.use(express.json());

function sanitizeWhatsAppMessage(text) {
  if (!text || typeof text !== 'string') {
    console.error("❌ Mensaje inválido:", text);
    return null;
  }
  
  let cleaned = text.trim();
  
  // 1. Remover bloques JSON completos
  cleaned = cleaned.replace(/\{[^}]*"intent"[^}]*\}/g, '');
  
  // 2. Remover líneas que contengan JSON
  cleaned = cleaned.split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && 
             !trimmed.startsWith('{') && 
             !trimmed.includes('"intent"') &&
             !trimmed.includes('"priority"') &&
             !trimmed.includes('"notify_human"');
    })
    .join('\n')
    .trim();
  
  // 3. Remover markdown code blocks
  cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // 4. Remover { o } sueltos al final
  cleaned = cleaned.replace(/\s*[{}]\s*$/g, '').trim();
  
  // 5. Validar que no esté vacío
  if (cleaned.length === 0) {
    console.error("❌ Mensaje quedó vacío después de limpiar");
    console.error("❌ Texto original:", text);
    return null;
  }
  
  // 6. Validar longitud mínima razonable
  if (cleaned.length < 5) {
    console.error("❌ Mensaje muy corto:", cleaned);
    return null;
  }
  
  // 7. Validar longitud máxima (WhatsApp permite hasta 4096 caracteres)
  if (cleaned.length > 4096) {
    console.warn("⚠️ Mensaje muy largo, truncando...");
    cleaned = cleaned.substring(0, 4093) + "...";
  }
  
  console.log(`✅ Mensaje sanitizado (${cleaned.length} chars): "${cleaned.substring(0, 100)}..."`);
  
  return cleaned;
}


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
  VERCEL_ENV,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const USE_WEBHOOK = VERCEL === "1" && VERCEL_ENV === "production" && PUBLIC_URL;
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: !USE_WEBHOOK });

// Configuración webhook
if (USE_WEBHOOK) {
  const baseUrl = PUBLIC_URL.replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/telegram/webhook`;

  console.log(`🔗 Configurando webhook en producción: ${webhookUrl}`);

  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    url: webhookUrl,
    drop_pending_updates: true,
    allowed_updates: ["message", "edited_message"]
  })
    .then((response) => {
      console.log(`✅ Webhook configurado exitosamente`);
      console.log(`📊 Respuesta:`, JSON.stringify(response.data, null, 2));
      return axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    })
    .then((infoResponse) => {
      console.log(`📊 Webhook info:`, JSON.stringify(infoResponse.data, null, 2));
    })
    .catch((err) => {
      console.error(`❌ Error configurando webhook:`, err.response?.data || err.message);
    });
} else if (VERCEL === "1" && VERCEL_ENV !== "production") {
  console.log(`⚠️ Preview deployment detectado (${VERCEL_ENV}) - NO se configura webhook`);
} else {
  console.log(`🔄 Modo local - usando polling`);
}

const ADMIN = (TELEGRAM_ADMIN_CHAT_ID || "").toString();
const PANEL_CHAT_ID = (TELEGRAM_GROUP_CHAT_ID || "").toString();
const PANEL_TOPIC_ID = Number(TELEGRAM_TOPIC_ID_DEFAULT || 0);

const phoneToTopic = new Map();
const topicToPhone = new Map();

// Control de conversaciones activas
const activeConversations = new Map();

// Lista negra de palabras ofensivas
const OFFENSIVE_WORDS = [
  'chucha', 'mierda', 'carajo', 'huevón', 'conchatumadre', 'ctm',
  'puta', 'verga', 'cojudo', 'imbécil', 'idiota', 'estúpido',
  'pendejo', 'gil', 'boludo', 'sonso', 'tarado'
];

function containsOffensiveLanguage(text) {
  const lowerText = text.toLowerCase();
  return OFFENSIVE_WORDS.some(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(lowerText);
  });
}

// Palabras de emergencia
const emergencyKeywords = [
  "no quiero vivir", "quiero terminar con todo", "me quiero morir", "no vale la pena",
  "quiero hacerme daño", "pensamientos suicidas", "suicid", "matarme", "quitarme la vida"
];
const crisisMessage =
  "Lamento profundamente que estés sintiendo esto... 🆘 Línea 113 (Perú) • Emergencias 116 • Acude al hospital más cercano.";

// Quick answers
function quickAnswers(text, conversationContext = null) {
  const t = (text || "").toLowerCase();

  if (conversationContext?.isHumanHandling || conversationContext?.awaitingScheduling) {
    return null;
  }

  if (/(precio|cu[aá]nto cuesta|cuanto|tarifa|costo)/.test(t) &&
    !/(agendar|cita|reservar)/.test(t)) {
    return "Nuestros precios:\n• Terapia psicológica: S/ 140 (50 min, online)\n• Consulta psiquiátrica: S/ 200 (online)\n¿Te gustaría agendar una cita?";
  }

  if (/(horario|atienden|atenci[oó]n|abren|disponibilidad)/.test(t) &&
    !/(agendar|cita|reservar)/.test(t)) {
    return "Horarios:\n• L–V: 9:00–20:00\n• Sáb: 9:00–14:00\nDomingo cerrado.\n¿Deseas agendar?";
  }

  if (/(pago|pagar|yape|plin|transfer)/.test(t) &&
    !/(agendar|cita|reservar)/.test(t)) {
    return "Formas de pago: Yape, Plin y transferencia. Te compartimos los datos al confirmar la cita.";
  }

  return null;
}

async function sendWhatsAppText(to, text) {
  // 🆕 SANITIZAR MENSAJE
  const cleanText = sanitizeWhatsAppMessage(text);
  
  if (!cleanText) {
    console.error(`❌ No se puede enviar mensaje vacío a ${to}`);
    console.error(`Texto original:`, text);
    return false;
  }
  
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] WhatsApp → ${to}: ${cleanText.substring(0, 100)}...`);
    return true;
  }
  
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  console.log(`📤 Enviando WhatsApp a ${to}`);
  console.log(`📝 Contenido: "${cleanText.substring(0, 150)}..."`);
  
  try {
    const response = await axios.post(
      url,
      { 
        messaging_product: "whatsapp", 
        to, 
        type: "text", 
        text: { body: cleanText } 
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
    );
    
    console.log(`✅ WhatsApp enviado exitosamente a ${to}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error enviando WhatsApp a ${to}:`);
    console.error(`Status: ${error.response?.status}`);
    console.error(`Error:`, error.response?.data || error.message);
    
    // Si el error es por contenido vacío, intentar con mensaje genérico
    if (error.response?.data?.error?.code === 100) {
      console.log(`🔄 Reintentando con mensaje de respaldo...`);
      try {
        await axios.post(
          url,
          { 
            messaging_product: "whatsapp", 
            to, 
            type: "text", 
            text: { body: "Gracias por escribirnos. Un miembro de nuestro equipo te atenderá en breve. 😊" } 
          },
          { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
        );
        console.log(`✅ Mensaje de respaldo enviado`);
        return true;
      } catch (retryError) {
        console.error(`❌ Error en reintento:`, retryError.response?.data || retryError.message);
        return false;
      }
    }
    
    return false;
  }
}

function escapeHTML(s = "") {
  return s.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const body = `<b>${escapeHTML(title)}</b>\n${lines.map(escapeHTML).join("\n")}${phone ? `\n📱 <code>${escapeHTML(phone)}</code>` : ""}`;
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

      if (err.message.includes("thread not found") || err.message.includes("message thread not found")) {
        console.log(`🔄 Topic ${topicId} no existe, recreando...`);

        try {
          if (phone) {
            await supabase.from("fh_topics").delete().eq("phone", phone);
            phoneToTopic.delete(phone);
            topicToPhone.delete(topicId);
            console.log(`🗑️ Registro viejo eliminado de BD para ${phone}`);
          }

          const newTopicId = await ensureTopicForPhone(phone);
          console.log(`✅ Nuevo topic creado: ${newTopicId}`);

          await bot.sendMessage(PANEL_CHAT_ID, body, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            message_thread_id: newTopicId,
          });
          console.log(`✅ Mensaje enviado al nuevo topic ${newTopicId}`);
        } catch (retryErr) {
          console.error(`❌ Error recreando topic:`, retryErr.message);

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

// Comandos de Telegram
let MODE = "smart";

bot.onText(/^\/modo(?:\s+(\w+))?$/i, (msg, m) => {
  console.log(`🤖 Comando /modo recibido de ${msg.chat.id}`);
  if (String(msg.chat.id) !== ADMIN) return bot.sendMessage(msg.chat.id, "No autorizado.");
  const next = (m[1] || "").toLowerCase();
  if (!next) return bot.sendMessage(msg.chat.id, `Modo actual: ${MODE}\nUsa: /modo auto | /modo manual | /modo smart`);
  if (!["auto", "manual", "smart"].includes(next)) return bot.sendMessage(msg.chat.id, "Modo inválido.");
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

// TG → WA con filtro de mensajes ofensivos
if (!USE_WEBHOOK) {
  bot.on("message", async (msg) => {
    try {
      if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
      if (!msg.message_thread_id) return;
      if (msg.from?.is_bot) return;

      const text = (msg.text || "").trim();
      if (!text || text.startsWith("/")) return;

      if (containsOffensiveLanguage(text)) {
        console.log(`🚫 MENSAJE OFENSIVO BLOQUEADO de ${msg.from.username || msg.from.first_name}`);
        await bot.sendMessage(PANEL_CHAT_ID,
          `⚠️ <b>MENSAJE BLOQUEADO</b>\n\n` +
          `El mensaje contenía lenguaje inapropiado y NO fue enviado al cliente.\n\n` +
          `Por favor, mantén un lenguaje profesional y empático en todo momento.\n\n` +
          `<i>Usuario: @${msg.from.username || msg.from.first_name}</i>`,
          {
            parse_mode: "HTML",
            message_thread_id: msg.message_thread_id,
          }
        );

        if (ADMIN && String(msg.chat.id) !== ADMIN) {
          await bot.sendMessage(ADMIN,
            `⚠️ <b>ALERTA: Mensaje ofensivo bloqueado</b>\n\n` +
            `Usuario: @${msg.from.username || msg.from.first_name}\n` +
            `Topic: ${msg.message_thread_id}\n` +
            `Mensaje: "${text}"\n\n` +
            `El mensaje NO fue enviado al cliente.`,
            { parse_mode: "HTML" }
          );
        }
        return;
      }

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

      activeConversations.set(phone, {
        lastMessageTime: Date.now(),
        isHumanHandling: true,
        awaitingScheduling: false
      });

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

// HTTP ENDPOINTS

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
      console.log("⚠️ Telegram webhook sin mensaje");
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

    if (isBot) {
      console.log("⚠️ Mensaje de bot, ignorando");
      return res.sendStatus(200);
    }

    if (text.startsWith("/")) {
      console.log(`🤖 Comando detectado: ${text}`);
      return res.sendStatus(200);
    }

    if (chatId === PANEL_CHAT_ID && topicId && text) {
      if (containsOffensiveLanguage(text)) {
        console.log(`🚫 MENSAJE OFENSIVO BLOQUEADO (webhook) de ${fromUser}`);
        await bot.sendMessage(PANEL_CHAT_ID,
          `⚠️ <b>MENSAJE BLOQUEADO</b>\n\n` +
          `El mensaje contenía lenguaje inapropiado y NO fue enviado al cliente.\n\n` +
          `Por favor, mantén un lenguaje profesional y empático en todo momento.\n\n` +
          `<i>Usuario: @${fromUser}</i>`,
          {
            parse_mode: "HTML",
            message_thread_id: topicId,
          }
        );

        if (ADMIN && chatId !== ADMIN) {
          await bot.sendMessage(ADMIN,
            `⚠️ <b>ALERTA: Mensaje ofensivo bloqueado</b>\n\n` +
            `Usuario: @${fromUser}\n` +
            `Topic: ${topicId}\n` +
            `Mensaje: "${text}"\n\n` +
            `El mensaje NO fue enviado al cliente.`,
            { parse_mode: "HTML" }
          );
        }
        return res.sendStatus(200);
      }

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

        activeConversations.set(phone, {
          lastMessageTime: Date.now(),
          isHumanHandling: true,
          awaitingScheduling: false
        });

        await sendWhatsAppText(phone, text);
        await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);

        console.log(`✅ Mensaje reenviado exitosamente`);

        await bot.sendMessage(PANEL_CHAT_ID, `📤 Enviado a <code>${escapeHTML(phone)}</code>`, {
          parse_mode: "HTML",
          message_thread_id: topicId,
        });
      } else {
        console.error(`❌ NO SE ENCONTRÓ TELÉFONO para topic ${topicId}`);

        await bot.sendMessage(PANEL_CHAT_ID,
          `⚠️ Error: No se encontró el número de teléfono asociado a este topic.\nTopic ID: ${topicId}`,
          { message_thread_id: topicId }
        );
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("❌ TG WEBHOOK ERROR:");
    console.error(e);
    return res.sendStatus(200);
  }
});

// Webhook de WhatsApp (GET - verificación)
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

// Webhook de WhatsApp (POST - mensajes)
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

    // Obtener contexto de conversación
    const conversationContext = activeConversations.get(from);
    const timeSinceLastMessage = conversationContext
      ? Date.now() - conversationContext.lastMessageTime
      : Infinity;

    // Si pasaron más de 15 minutos, resetear el flag de humano
    if (timeSinceLastMessage > 15 * 60 * 1000) {
      if (conversationContext) {
        conversationContext.isHumanHandling = false;
      }
    }

    // Emergencia
    const isEmergency = emergencyKeywords.some(k => text.toLowerCase().includes(k));
    if (isEmergency) {
      console.log(`🚨 EMERGENCIA detectada de ${from}`);
      await sendWhatsAppText(from, crisisMessage);
      await notifyTelegram("🚨 EMERGENCIA DETECTADA", [`💬 "${text}"`, "⚠️ Protocolo enviado. IA bloqueada."], from);
      await saveMeta({ phone: from, emergency: true, required_human: true });

      activeConversations.set(from, {
        lastMessageTime: Date.now(),
        isHumanHandling: true,
        awaitingScheduling: false
      });

      return res.sendStatus(200);
    }

    // Quick answers con contexto
    const quick = quickAnswers(text, conversationContext);
    if (quick) {
      console.log(`⚡ Quick answer para ${from}`);
      await sendWhatsAppText(from, quick);
      await notifyTelegram("✅ Respondido automático (Quick)", [`💬 "${text}"`], from);
      await saveMeta({ phone: from });

      activeConversations.set(from, {
        lastMessageTime: Date.now(),
        isHumanHandling: false,
        awaitingScheduling: false
      });

      return res.sendStatus(200);
    }

    // Si un humano está manejando, NO responder con IA
    if (conversationContext?.isHumanHandling && timeSinceLastMessage < 15 * 60 * 1000) {
      console.log(`👤 Conversación manejada por humano, solo notificando...`);
      await notifyTelegram("💬 NUEVO MENSAJE (en conversación activa)", [`💬 "${text}"`], from);
      await saveMeta({ phone: from, required_human: true });

      // Actualizar timestamp
      conversationContext.lastMessageTime = Date.now();

      return res.sendStatus(200);
    }

    // IA (Gemini)

    //emmh i
    // IA (tu código existente)
    console.log(`🤖 Consultando IA para mensaje de ${from}`);
    const { message: aiMessage, meta } = await generateAIReply({
      text,
      conversationContext,
      phone: from
    });

    // 🆕 VALIDAR que el mensaje de IA no esté vacío
    if (!aiMessage || aiMessage.trim().length === 0) {
      console.error(`❌ IA devolvió mensaje vacío`);
      console.error(`Respuesta original:`, aiMessage);
      
      // Usar mensaje de respaldo
      const fallbackMessage = "Gracias por tu mensaje. Un miembro de nuestro equipo te atenderá en breve. 😊";
      
      await sendWhatsAppText(from, fallbackMessage);
      await notifyTelegram("⚠️ IA devolvió mensaje vacío", [
        `💬 "${text}"`,
        `🤖 Se usó mensaje de respaldo`
      ], from);
      
      meta.notify_human = true;
      meta.priority = 'high';
      
      activeConversations.set(from, {
        lastMessageTime: Date.now(),
        isHumanHandling: true,
        awaitingScheduling: false
      });
      
      await saveMeta({ phone: from, required_human: true });
      return res.sendStatus(200);
    }

    let finalMessage = aiMessage;

    if (meta?.intent === 'agendar' && meta?.service === 'therapy') {
      const calendlyUrl = process.env.CALENDLY_THERAPY_URL;
      if (calendlyUrl) {
        finalMessage += `\n\n📅 Agenda aquí tu cita de terapia psicológica:\n${calendlyUrl}`;
        console.log(`📅 Link de Calendly agregado para terapia`);
      }
    }

    if (meta?.intent === 'agendar' && meta?.service === 'psychiatry') {
      finalMessage += `\n\n👤 Para coordinar tu consulta psiquiátrica, un miembro de nuestro equipo te contactará en breve para confirmar disponibilidad.`;
      meta.notify_human = true;
      console.log(`👤 Consulta psiquiátrica detectada - derivando a humano`);
    }

    console.log(`🤖 IA respondió | intent: ${meta?.intent} | priority: ${meta?.priority} | notify: ${meta?.notify_human}`);

    await notifyTelegram("🔔 NUEVO MENSAJE", [
      `💬 "${text}"`,
      `🤖 IA: intent=${meta?.intent} priority=${meta?.priority} notify=${meta?.notify_human}`,
    ], from);

    const shouldAutoReply = !meta?.notify_human;
    await saveMeta({ phone: from, required_human: !shouldAutoReply });

    const isSchedulingIntent = ['agendar', 'scheduling', 'appointment'].includes(meta?.intent);

    activeConversations.set(from, {
      lastMessageTime: Date.now(),
      isHumanHandling: !shouldAutoReply,
      awaitingScheduling: isSchedulingIntent,
      lastIntent: meta?.intent,
      context: text
    });

    if (shouldAutoReply) {
      console.log(`🤖 Auto-respondiendo a ${from}`);
      console.log(`📝 Mensaje final a enviar: "${finalMessage.substring(0, 200)}..."`);
      
      const sent = await sendWhatsAppText(from, finalMessage);
      
      if (!sent) {
        console.error(`❌ Fallo al enviar mensaje, derivando a humano`);
        meta.notify_human = true;
        activeConversations.set(from, {
          lastMessageTime: Date.now(),
          isHumanHandling: true,
          awaitingScheduling: false
        });
      }
    } else {
      console.log(`👤 Requiere respuesta humana para ${from}`);
      const topicId = await ensureTopicForPhone(from);
      if (topicId && PANEL_CHAT_ID) {
        await bot.sendMessage(PANEL_CHAT_ID,
          `⚠️ <b>REQUIERE ATENCIÓN HUMANA</b>\n\n` +
          `El cliente necesita ayuda personalizada.\n` +
          `✍️ Escribe tu respuesta en este tema.\n\n` +
          `<i>Contexto: ${meta?.intent || 'general'} (prioridad: ${meta?.priority || 'low'})</i>`,
          {
            parse_mode: "HTML",
            message_thread_id: topicId,
          }
        );
      } else if (ADMIN) {
        await bot.sendMessage(ADMIN, `✍️ Responde con:\n/enviar ${from} | (tu respuesta)`);
      }
    }
//emmh f
    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Webhook error:", e?.response?.data || e.message);
    res.sendStatus(200);
  }
});

// Endpoint para resetear conversación
app.post("/admin/reset-conversation", async (req, res) => {
  const { admin_key, phone } = req.body;

  if (admin_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: "No autorizado" });
  }

  activeConversations.delete(phone);

  return res.json({
    success: true,
    message: `Conversación para ${phone} reseteada`
  });
});

// Endpoint para ver conversaciones activas
app.get("/admin/active-conversations", async (req, res) => {
  const { admin_key } = req.query;

  if (admin_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: "No autorizado" });
  }

  const conversations = [];
  const now = Date.now();

  for (const [phone, context] of activeConversations.entries()) {
    conversations.push({
      phone,
      isHumanHandling: context.isHumanHandling,
      awaitingScheduling: context.awaitingScheduling,
      lastIntent: context.lastIntent,
      minutesSinceLastMessage: Math.floor((now - context.lastMessageTime) / 60000)
    });
  }

  return res.json({
    total: conversations.length,
    conversations
  });
});

// Export para Vercel / local
if (VERCEL !== "1") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🚀 Local http://localhost:${port}`));
}

export default (req, res) => app(req, res);