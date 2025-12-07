// src/app.js - VERSIÓN CORREGIDA
import dotenv from "dotenv";
import express from "express";
import axios from "axios";
import FormData from "form-data";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import { generateAIReply, synthesizeAudioFromText, transcribeAudioBuffer } from "./services/ai.service.js";
import {
  deleteConversationState,
  getConversationState,
  getStateMetrics,
  listActiveConversations,
  mergeConversationState,
} from "./services/state.service.js";
import { buildHealthPayload, getBotMode } from "./utils/health.utils.js";

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
  VERCEL_ENV,
} = process.env;

const ENABLE_AUDIO_TRANSCRIPTION = (process.env.WHATSAPP_AUDIO_TRANSCRIPTION ?? "1") === "1";
const ENABLE_AUDIO_RESPONSES = (process.env.WHATSAPP_AUDIO_RESPONSES ?? "0") === "1";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const USE_WEBHOOK = VERCEL === "1" && VERCEL_ENV === "production" && PUBLIC_URL;
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: !USE_WEBHOOK });

async function checkSupabaseConnection() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, error: "Faltan credenciales de Supabase" };
  }

  try {
    const { error } = await supabase
      .from("fh_topics")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function checkTelegramConnection() {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Falta TELEGRAM_BOT_TOKEN" };
  }

  try {
    const me = await bot.getMe();
    return { ok: true, username: me?.username, id: me?.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Configuración webhook
if (USE_WEBHOOK) {
  const baseUrl = PUBLIC_URL.replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/telegram/webhook`;

  console.log(`🔗 Configurando webhook en producción: ${webhookUrl}`);

  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    url: webhookUrl,
    drop_pending_updates: true,
    allowed_updates: ["message", "edited_message", "callback_query"]
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


const HUMAN_TIMEOUT = 15 * 60 * 1000; // 15 minutos
const HUMAN_WARNING_TIME = 12 * 60 * 1000; // Avisar a los 12 min
const timeoutWarnings = new Map(); // Almacenar timeouts de advertencia

const phoneToTopic = new Map();
const topicToPhone = new Map();

const SERVICE_BUTTON_IDS = {
  therapy: "FH_SERVICE_THERAPY",
  psychiatry: "FH_SERVICE_PSYCHIATRY",
};

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

  if (conversationContext?.priceConfirmed ||
      conversationContext?.awaitingPriceConfirmation ||
      conversationContext?.awaitingPaymentConfirmation ||
      conversationContext?.isHumanHandling ||
      conversationContext?.awaitingScheduling) {
    return null;
  }

  if (/(precio|cu[aá]nto cuesta|cuanto|tarifa|costo)/.test(t) &&
    !/(agendar|cita|reservar)/.test(t)) {
    return "Nuestros precios:\n• Terapia psicológica: S/ 85 (50 min, Presencial/Online)\n• Consulta psiquiátrica: S/ 139 (online)\n¿Te gustaría agendar una cita?";
  }

/*   if (/(horario|atienden|atenci[oó]n|abren|disponibilidad)/.test(t) &&
    !/(agendar|cita|reservar)/.test(t)) {
    return "Horarios:\n• L–V: 9:00–21:00\n• Sáb: 9:00–21:00\nDomingo 9:00–18:00.\n¿Deseas agendar?";
  }
 */
  if (/(^pago$|^pagos$|formas de pago|como.*pago|m[ée]todos.*pago)/.test(t) &&
    !/(link|enlace|datos|yape|plin|cuenta|n[uú]mero)/.test(t) &&
    !/(agendar|cita|reservar)/.test(t)) {
    return "Formas de pago: Yape, Plin y transferencia. Te compartimos los datos al confirmar la cita.";
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

async function sendWhatsAppButtons(to) {
  const welcomeText =
    "Hola 👋 Soy el asistente virtual de Feliz Horizonte. ¿Te gustaría hablar con psicología o psiquiatría?";

  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] Botones WhatsApp → ${to}: ${welcomeText}`);
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  console.log(`📤 Enviando botones de bienvenida a ${to}`);
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: welcomeText },
        action: {
          buttons: [
            { type: "reply", reply: { id: SERVICE_BUTTON_IDS.therapy, title: "Psicología" } },
            { type: "reply", reply: { id: SERVICE_BUTTON_IDS.psychiatry, title: "Psiquiatría" } },
          ],
        },
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );
  console.log(`✅ Botones enviados a ${to}`);
}

function guessFilenameFromMime(mediaId, mimeType, fallbackPrefix = "file") {
  const safeId = mediaId || Date.now();
  const extension = (mimeType?.split("/")[1] || "bin").split(";")[0];
  return `${fallbackPrefix}-${safeId}.${extension}`;
}

function guessMimeFromFilename(filename) {
  if (!filename) return null;

  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "3gp":
    case "3gpp":
      return "video/3gpp";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "txt":
      return "text/plain";
    case "aac":
      return "audio/aac";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
      return "audio/ogg";
    case "opus":
      return "audio/opus";
    case "amr":
      return "audio/amr";
    default:
      return null;
  }
}

async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("No hay credenciales de la API de WhatsApp para descargar archivos");
  }
  if (!mediaId) {
    throw new Error("mediaId no proporcionado");
  }

  const baseHeaders = { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` };
  const metaUrl = `https://graph.facebook.com/v20.0/${mediaId}`;

  const metaResponse = await axios.get(metaUrl, { headers: baseHeaders });
  const mediaUrl = metaResponse?.data?.url;
  if (!mediaUrl) {
    throw new Error("No se recibió una URL para el recurso multimedia");
  }

  const fileResponse = await axios.get(mediaUrl, {
    headers: baseHeaders,
    responseType: "arraybuffer",
  });

  const mimeType = metaResponse?.data?.mime_type || fileResponse.headers["content-type"] || "application/octet-stream";

  return {
    buffer: Buffer.from(fileResponse.data),
    mimeType,
    sha256: metaResponse?.data?.sha256 || null,
    mediaId,
    filename: guessFilenameFromMime(mediaId, mimeType),
  };
}

async function transcribeWhatsAppAudio(msg) {
  if (!ENABLE_AUDIO_TRANSCRIPTION) {
    return {
      text: "",
      transcribed: false,
    };
  }

  const audioPayload = msg?.audio || msg?.voice || null;
  const mediaId = audioPayload?.id;

  if (!mediaId) {
    throw new Error("Mensaje de audio sin mediaId");
  }

  const media = await downloadWhatsAppMedia(mediaId);
  const transcription = await transcribeAudioBuffer({
    buffer: media.buffer,
    mimeType: media.mimeType,
  });

  return {
    text: transcription,
    mimeType: media.mimeType,
    transcribed: Boolean(transcription),
  };
}

async function uploadWhatsAppMedia(buffer, mimeType = "application/octet-stream", filename = null) {
  if (!buffer || !buffer.length) {
    throw new Error("Buffer de archivo vacío");
  }

  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] Subir archivo (${mimeType}) - ${buffer.length} bytes`);
    return { id: "simulated-media-id" };
  }

  const uploadUrl = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append(
    "file",
    buffer,
    {
      filename: filename || guessFilenameFromMime("media", mimeType),
      contentType: mimeType,
    }
  );

  const response = await axios.post(uploadUrl, form, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
  });

  return response?.data;
}

async function uploadWhatsAppAudio(buffer, mimeType = "audio/mpeg") {
  return uploadWhatsAppMedia(buffer, mimeType, `voz-${Date.now()}.${mimeType.split("/")[1] || "mp3"}`);
}

async function sendWhatsAppAudioMessage(to, audioBuffer, mimeType = "audio/mpeg") {
  if (!audioBuffer || !audioBuffer.length) {
    throw new Error("Audio vacío para enviar");
  }

  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] Audio WhatsApp → ${to} (${mimeType}, ${audioBuffer.length} bytes)`);
    return;
  }

  const upload = await uploadWhatsAppAudio(audioBuffer, mimeType);
  const mediaId = upload?.id;

  if (!mediaId) {
    throw new Error("No se obtuvo mediaId al subir el audio");
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: {
        id: mediaId,
        voice: true,
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );

  console.log(`🎧 Audio enviado a ${to}`);
}

async function sendWhatsAppDocument(to, buffer, mimeType = "application/octet-stream", filename = "archivo", caption = "") {
  if (!buffer || !buffer.length) {
    throw new Error("Archivo vacío para enviar");
  }

  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] Documento WhatsApp → ${to} (${mimeType}, ${buffer.length} bytes)`);
    return;
  }

  const effectiveMimeType = mimeType || guessMimeFromFilename(filename) || "application/octet-stream";
  const upload = await uploadWhatsAppMedia(buffer, effectiveMimeType, filename);
  const mediaId = upload?.id;

  if (!mediaId) {
    throw new Error("No se obtuvo mediaId al subir el documento");
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename: filename,
        caption: caption || undefined,
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );

  console.log(`📎 Documento enviado a ${to}`);
}

async function sendWhatsAppImage(to, buffer, mimeType = "image/jpeg", caption = "") {
  if (!buffer || !buffer.length) {
    throw new Error("Imagen vacía para enviar");
  }

  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] Imagen WhatsApp → ${to} (${mimeType}, ${buffer.length} bytes)`);
    return;
  }

  const upload = await uploadWhatsAppMedia(buffer, mimeType, `imagen-${Date.now()}.${mimeType.split("/")[1] || "jpg"}`);
  const mediaId = upload?.id;

  if (!mediaId) {
    throw new Error("No se obtuvo mediaId al subir la imagen");
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        id: mediaId,
        caption,
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );

  console.log(`🖼️ Imagen enviada a ${to}`);
}

async function sendWhatsAppVideo(to, buffer, mimeType = "video/mp4", caption = "") {
  if (!buffer || !buffer.length) {
    throw new Error("Video vacío para enviar");
  }

  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`📱 [SIMULADO] Video WhatsApp → ${to} (${mimeType}, ${buffer.length} bytes)`);
    return;
  }

  const upload = await uploadWhatsAppMedia(buffer, mimeType, `video-${Date.now()}.${mimeType.split("/")[1] || "mp4"}`);
  const mediaId = upload?.id;

  if (!mediaId) {
    throw new Error("No se obtuvo mediaId al subir el video");
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "video",
      video: {
        id: mediaId,
        caption: caption || undefined,
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` } }
  );

  console.log(`🎬 Video enviado a ${to}`);
}

async function sendVoiceNoteIfEnabled(to, text, source = "ai") {
  if (!ENABLE_AUDIO_RESPONSES) return;

  const cleanText = (text || "").trim();
  if (!cleanText) return;

  try {
    const { buffer, mimeType } = await synthesizeAudioFromText(cleanText);
    await sendWhatsAppAudioMessage(to, buffer, mimeType);
    console.log(`🎤 Audio (${source}) enviado a ${to}`);
  } catch (err) {
    console.error(`⚠️ Error enviando audio (${source}):`, err?.response?.data || err.message);
  }
}

async function forwardMediaToTelegram({ phone, buffer, mimeType, caption = "", filename }) {
  if (!PANEL_CHAT_ID && !ADMIN) {
    console.log("⚠️ No hay chat configurado para reenviar archivos a Telegram");
    return;
  }

  const topicId = await ensureTopicForPhone(phone);
  const chatId = PANEL_CHAT_ID || ADMIN;
  const sendOptions = { caption, message_thread_id: topicId };
  const fileOptions = { filename: filename || guessFilenameFromMime("wa", mimeType), contentType: mimeType };

  try {
    if ((mimeType || "").startsWith("image/")) {
      await bot.sendPhoto(chatId, buffer, sendOptions, fileOptions);
    } else {
      await bot.sendDocument(chatId, buffer, sendOptions, fileOptions);
    }
    console.log(`📎 Archivo reenviado a Telegram (topic ${topicId})`);
  } catch (err) {
    console.error("❌ Error reenviando archivo a Telegram:", err?.message);
  }
}

async function downloadTelegramFile(fileId, preferredMimeType = null, filename = null) {
  const url = await bot.getFileLink(fileId);
  const response = await axios.get(url, { responseType: "arraybuffer" });

  const headerMime = response.headers["content-type"] || null;
  const guessedMime = preferredMimeType || guessMimeFromFilename(filename) || headerMime || "application/octet-stream";

  return {
    buffer: Buffer.from(response.data),
    mimeType: guessedMime,
  };
}

async function forwardTelegramMediaToWhatsApp({ msg, phone }) {
  const caption = (msg.caption || "").trim();

  if (msg.document) {
    const { buffer, mimeType } = await downloadTelegramFile(
      msg.document.file_id,
      msg.document.mime_type,
      msg.document.file_name
    );
    const filename = msg.document.file_name || guessFilenameFromMime("tg", mimeType);
    await sendWhatsAppDocument(phone, buffer, mimeType, filename, caption);
    return { type: "document", caption };
  }

  if (msg.video) {
    const { buffer, mimeType } = await downloadTelegramFile(msg.video.file_id);
    await sendWhatsAppVideo(phone, buffer, mimeType || "video/mp4", caption);
    return { type: "video", caption };
  }

  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];
    const { buffer, mimeType } = await downloadTelegramFile(photo.file_id);
    await sendWhatsAppImage(phone, buffer, mimeType || "image/jpeg", caption);
    return { type: "photo", caption };
  }

  return null;
}

function escapeHTML(s = "") {
  return s.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Después de la función escapeHTML, AGREGAR esta función completa:

function scheduleTimeoutWarning(phone) {
  if (timeoutWarnings.has(phone)) {
    clearTimeout(timeoutWarnings.get(phone));
  }

  const warningTimeout = setTimeout(async () => {
    const topicId = await ensureTopicForPhone(phone);

    if (topicId && PANEL_CHAT_ID) {
      await bot.sendMessage(PANEL_CHAT_ID,
        `⏰ <b>AVISO DE INACTIVIDAD</b>\n\n` +
        `Han pasado 12 minutos sin actividad.\n` +
        `En 3 minutos devolveré el control a la IA.\n\n` +
        `<i>¿Deseas continuar atendiendo?</i>`,
        {
          parse_mode: "HTML",
          message_thread_id: topicId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "👤 Seguir atendiendo", callback_data: `keep_${phone}` }],
              [{ text: "🤖 Devolver a IA ahora", callback_data: `release_${phone}` }]
            ]
          }
        }
      );
    }

    setTimeout(async () => {
      const conversationContext = await getConversationState(phone);
      const timeSinceLastMessage = Date.now() - (conversationContext?.lastMessageTime || 0);

      if (conversationContext?.isHumanHandling && timeSinceLastMessage >= HUMAN_TIMEOUT) {
        await mergeConversationState(phone, {
          isHumanHandling: false,
          awaitingScheduling: false
        });

        if (topicId && PANEL_CHAT_ID) {
          await bot.sendMessage(PANEL_CHAT_ID,
            `⏰ <b>TIMEOUT AUTOMÁTICO</b>\n\n` +
            `Control devuelto a la IA por inactividad (15 min).\n\n` +
            `<code>${escapeHTML(phone)}</code>`,
            {
              parse_mode: "HTML",
              message_thread_id: topicId,
              reply_markup: {
                inline_keyboard: [[
                  { text: "👤 Retomar control", callback_data: `keep_${phone}` }
                ]]
              }
            }
          );
        }

        console.log(`⏰ Timeout automático: ${phone} devuelto a IA`);
      }
    }, HUMAN_TIMEOUT - HUMAN_WARNING_TIME);

  }, HUMAN_WARNING_TIME);

  timeoutWarnings.set(phone, warningTimeout);
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

async function handleCallbackQuery(query) {
  try {
    const data = query.data;
    const msgId = query.message.message_id;
    const chatId = query.message.chat.id;
    const topicId = query.message.message_thread_id;

    console.log(`🔘 Callback recibido: ${data}`);

    if (data.startsWith('release_')) {
      const phone = data.replace('release_', '');

      await mergeConversationState(phone, {
        isHumanHandling: false,
        awaitingScheduling: false,
        lastMessageTime: Date.now()
      });

      if (timeoutWarnings.has(phone)) {
        clearTimeout(timeoutWarnings.get(phone));
        timeoutWarnings.delete(phone);
      }

      await bot.editMessageText(
        `✅ Control devuelto a la IA para ${phone}\n\n` +
        `El bot responderá automáticamente los próximos mensajes.`,
        {
          chat_id: chatId,
          message_id: msgId,
          message_thread_id: topicId
        }
      );

      await bot.answerCallbackQuery(query.id, {
        text: '🤖 IA activada',
        show_alert: false
      });

      console.log(`✅ Control devuelto a IA para ${phone}`);
    }
    else if (data.startsWith('keep_')) {
      const phone = data.replace('keep_', '');

      await mergeConversationState(phone, {
        isHumanHandling: true,
        lastMessageTime: Date.now()
      });

      scheduleTimeoutWarning(phone);

      await bot.editMessageText(
        `👤 Control humano extendido para ${phone}\n\n` +
        `Continuarás atendiendo esta conversación.`,
        {
          chat_id: chatId,
          message_id: msgId,
          message_thread_id: topicId,
          reply_markup: {
            inline_keyboard: [[
              { text: "🤖 Devolver a IA ahora", callback_data: `release_${phone}` }
            ]]
          }
        }
      );

      await bot.answerCallbackQuery(query.id, {
        text: '⏰ Tiempo extendido',
        show_alert: false
      });

      console.log(`⏰ Timeout extendido para ${phone}`);
    }

  } catch (err) {
    console.error('❌ Error en callback_query:', err.message);
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Error procesando acción',
      show_alert: true
    });
  }
}

bot.on('callback_query', handleCallbackQuery);

bot.onText(/^\/auto$/i, async (msg) => {
  console.log(`🤖 Comando /auto recibido de ${msg.chat.id}`);
  if (String(msg.chat.id) !== PANEL_CHAT_ID) return;
  if (!msg.message_thread_id) return;

  const topicId = String(msg.message_thread_id);
  const phone = topicToPhone.get(topicId);

  if (!phone) {
    return bot.sendMessage(PANEL_CHAT_ID,
      "⚠️ No se encontró el teléfono asociado a este topic.",
      { message_thread_id: msg.message_thread_id }
    );
  }

  await mergeConversationState(phone, {
    isHumanHandling: false,
    awaitingScheduling: false,
    lastMessageTime: Date.now()
  });

  if (timeoutWarnings.has(phone)) {
    clearTimeout(timeoutWarnings.get(phone));
    timeoutWarnings.delete(phone);
  }

  await bot.sendMessage(PANEL_CHAT_ID,
    `✅ Control devuelto a la IA para <code>${escapeHTML(phone)}</code>\n\n` +
    `El bot responderá automáticamente los próximos mensajes.`,
    {
      parse_mode: "HTML",
      message_thread_id: msg.message_thread_id
    }
  );
});

bot.onText(/^\/estado$/i, async (msg) => {
  console.log(`📊 Comando /estado recibido de ${msg.chat.id}`);
  if (String(msg.chat.id) !== PANEL_CHAT_ID) return;
  if (!msg.message_thread_id) return;

  const topicId = String(msg.message_thread_id);
  const phone = topicToPhone.get(topicId);

  if (!phone) {
    return bot.sendMessage(PANEL_CHAT_ID,
      "⚠️ No se encontró el teléfono asociado a este topic.",
      { message_thread_id: msg.message_thread_id }
    );
  }

  const context = await getConversationState(phone);
  const timeSinceLastMessage = context?.lastMessageTime
    ? Math.floor((Date.now() - context.lastMessageTime) / 60000)
    : 'N/A';

  await bot.sendMessage(PANEL_CHAT_ID,
    `📊 <b>Estado de conversación</b>\n\n` +
    `📱 Teléfono: <code>${escapeHTML(phone)}</code>\n` +
    `🤖 Control: ${context?.isHumanHandling ? '👤 HUMANO' : '🤖 IA'}\n` +
    `⏰ Último mensaje: hace ${timeSinceLastMessage} min\n` +
    `🎯 Última intención: ${context?.lastIntent || 'N/A'}\n` +
    `📅 En agendamiento: ${context?.awaitingScheduling ? 'Sí' : 'No'}`,
    {
      parse_mode: "HTML",
      message_thread_id: msg.message_thread_id
    }
  );
});

// TG → WA con filtro de mensajes ofensivos
if (!USE_WEBHOOK) {
  bot.on("message", async (msg) => {
    try {
      if (String(msg.chat.id) !== String(PANEL_CHAT_ID)) return;
      if (!msg.message_thread_id) return;
      if (msg.from?.is_bot) return;

      const hasMedia = Boolean(msg.document || msg.video || (msg.photo?.length));
      const text = (msg.text || msg.caption || "").trim();
      if (!hasMedia && (!text || text.startsWith("/"))) return;

      if (text && containsOffensiveLanguage(text)) {
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

      const mediaForwarded = hasMedia
        ? await forwardTelegramMediaToWhatsApp({ msg, phone })
        : null;

      await mergeConversationState(phone, {
        lastMessageTime: Date.now(),
        isHumanHandling: true,
        awaitingScheduling: false
      });

      if (mediaForwarded) {
        await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);
        console.log(`✅ TG → WA archivo | topic ${topicId} → ${phone}`);
      } else {
        await sendWhatsAppText(phone, text);
        await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);
        console.log(`✅ TG → WA | topic ${topicId} → ${phone}`);
      }

      // Programar timeout automático
      scheduleTimeoutWarning(phone);

      await bot.sendMessage(PANEL_CHAT_ID,
        `📤 Enviado a <code>${escapeHTML(phone)}</code>\n\n` +
        `💡 <i>Cuando termines, devuelve el control:</i>`,
        {
          parse_mode: "HTML",
          message_thread_id: msg.message_thread_id,
          reply_markup: {
            inline_keyboard: [[
              { text: "🤖 Devolver a IA", callback_data: `release_${phone}` }
            ]]
          }
        }
      );

    } catch (e) {
      console.error("❌ TG→WA error:", e?.response?.data || e.message);
    }
  });
}

// HTTP ENDPOINTS

app.get("/health", async (_req, res) => {
  const [supabaseStatus, telegramStatus] = await Promise.all([
    checkSupabaseConnection(),
    checkTelegramConnection(),
  ]);

  const payload = buildHealthPayload({
    supabaseStatus,
    telegramStatus,
    mode: getBotMode(USE_WEBHOOK),
    extra: { timestamp: new Date().toISOString() },
  });

  res.status(payload.ok ? 200 : 503).json(payload);
});

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
    const callbackQuery = update?.callback_query;
    const msg = update?.message;

    console.log("📥 TELEGRAM WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(update, null, 2));

    if (callbackQuery) {
      console.log("📲 Procesando callback_query recibido por webhook");
      await handleCallbackQuery(callbackQuery);
      return res.sendStatus(200);
    }

    if (!msg) {
      console.log("⚠️ Telegram webhook sin mensaje");
      return res.sendStatus(200);
    }

    const chatId = String(msg.chat?.id);
    const hasMedia = Boolean(msg.document || msg.video || (msg.photo?.length));
    const text = (msg.text || msg.caption || "").trim();
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

    if (!hasMedia && text.startsWith("/")) {
      console.log(`🤖 Comando detectado: ${text}`);
      return res.sendStatus(200);
    }

    if (chatId === PANEL_CHAT_ID && topicId && (text || hasMedia)) {
      if (text && containsOffensiveLanguage(text)) {
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

        const mediaForwarded = hasMedia
          ? await forwardTelegramMediaToWhatsApp({ msg, phone })
          : null;

        await mergeConversationState(phone, {
          lastMessageTime: Date.now(),
          isHumanHandling: true,
          awaitingScheduling: false
        });

        if (mediaForwarded) {
          await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);
        } else {
          await sendWhatsAppText(phone, text);
          await supabase.from("mensajes").insert([{ chat_id: phone, mensaje: "[human]" }]);
        }

        console.log(`✅ Mensaje reenviado exitosamente`);

        // Programar timeout automático
        scheduleTimeoutWarning(phone);

        await bot.sendMessage(PANEL_CHAT_ID,
          `📤 Enviado a <code>${escapeHTML(phone)}</code>\n\n` +
          `💡 <i>Cuando termines, devuelve el control:</i>`,
          {
            parse_mode: "HTML",
            message_thread_id: topicId,
            reply_markup: {
              inline_keyboard: [[
                { text: "🤖 Devolver a IA", callback_data: `release_${phone}` }
              ]]
            }
          }
        );
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
    const audioPayload = msg.audio || msg.voice || null;
    const documentPayload = msg.document || null;
    const imagePayload = msg.image || null;
    let text = (msg.text?.body || audioPayload?.caption || documentPayload?.caption || imagePayload?.caption || "").trim();
    let conversationContext = await getConversationState(from);
    let audioTranscriptionInfo = null;

    const interactive = msg?.interactive;
    let buttonSelection = null;
    let selectionTitle = "";

    if (interactive?.button_reply) {
      buttonSelection = interactive.button_reply.id;
      selectionTitle = interactive.button_reply.title || "";
    } else if (interactive?.list_reply) {
      buttonSelection = interactive.list_reply.id;
      selectionTitle = interactive.list_reply.title || "";
    }

    if (selectionTitle) {
      text = selectionTitle.trim();
    } else {
      text = text.trim();
    }

    if (!text && buttonSelection) {
      text = buttonSelection;
    }

    if (!text && audioPayload) {
      try {
        audioTranscriptionInfo = await transcribeWhatsAppAudio(msg);
        text = audioTranscriptionInfo.text?.trim();

        if (!text) {
          throw new Error("Transcripción vacía");
        }
      } catch (err) {
        console.error("❌ No se pudo transcribir el audio:", err?.response?.data || err.message);
        await notifyTelegram(
          "⚠️ AUDIO SIN TRANSCRIPCIÓN",
          [
            `ID: ${audioPayload?.id || "N/A"}`,
            `Motivo: ${err?.message || "Error desconocido"}`,
          ],
          from
        );
        await sendWhatsAppText(
          from,
          "Recibí tu audio pero no pude procesarlo. ¿Podrías escribirme lo más importante por texto, por favor? 💙"
        );
        return res.sendStatus(200);
      }
    }

    const mediaPayload = documentPayload || imagePayload;

    if (mediaPayload) {
      try {
        const media = await downloadWhatsAppMedia(mediaPayload.id);
        const caption = text || (documentPayload ? "📎 Documento enviado" : "🖼️ Imagen enviada");

        await forwardMediaToTelegram({
          phone: from,
          buffer: media.buffer,
          mimeType: media.mimeType,
          caption,
          filename: media.filename,
        });

        await notifyTelegram("📎 Archivo recibido por WhatsApp", [
          caption || "(sin texto)",
          `Tipo: ${media.mimeType}`,
        ], from);

        await sendWhatsAppText(from, "📑 Recibimos tu archivo. En breve lo revisaremos.");
        await mergeConversationState(from, {
          lastMessageTime: Date.now(),
          isHumanHandling: true,
          awaitingScheduling: false,
        });
      } catch (err) {
        console.error("❌ Error procesando archivo entrante:", err?.response?.data || err.message);
        await notifyTelegram("⚠️ Error al procesar archivo", [
          `Motivo: ${err?.message || "Desconocido"}`,
        ], from);
      }

      return res.sendStatus(200);
    }

    if (buttonSelection) {
      let selectedService = null;
      if (buttonSelection === SERVICE_BUTTON_IDS.therapy) {
        selectedService = "therapy";
      } else if (buttonSelection === SERVICE_BUTTON_IDS.psychiatry) {
        selectedService = "psychiatry";
      }

      if (selectedService) {
        console.log(`🎯 Botón seleccionado (${selectedService}) por ${from}`);
        conversationContext = await mergeConversationState(from, { servicePreference: selectedService });
      }
    }

    const logPrefix = audioTranscriptionInfo ? "🎤 (audio)" : "💬";
    console.log(`${logPrefix} WhatsApp de ${from}: "${text}"`);
    const incomingTelegramLine = `${audioTranscriptionInfo ? "🎤" : "💬"} "${text || '(sin texto)'}"`;

    await ensureTopicForPhone(from);

    const lastMessageTimestamp = conversationContext?.lastMessageTime || 0;
    const timeSinceLastMessage = lastMessageTimestamp
      ? Date.now() - lastMessageTimestamp
      : Infinity;

    if (!conversationContext) {
      conversationContext = await mergeConversationState(from, {});
    }

    const isInSchedulingProcess =
      conversationContext?.priceConfirmed ||
      conversationContext?.awaitingPriceConfirmation ||
      conversationContext?.awaitingPaymentConfirmation ||
      conversationContext?.awaitingScheduling ||
      conversationContext?.isHumanHandling;

    let justSentButtons = false;

    if (!conversationContext.buttonsSent && !isInSchedulingProcess) {
      try {
        await sendWhatsAppButtons(from);
        conversationContext = await mergeConversationState(from, { buttonsSent: true });
        justSentButtons = true;
      } catch (err) {
        console.error("❌ Error enviando botones de bienvenida:", err?.response?.data || err.message);
      }
    }

    if (justSentButtons && !buttonSelection && !isInSchedulingProcess) {
      console.log(`⏸️ Botones enviados a ${from}, esperando selección antes de responder con IA`);
      await mergeConversationState(from, {
        lastMessageTime: Date.now(),
        context: text,
      });

      await notifyTelegram("🔔 NUEVO MENSAJE", [
        incomingTelegramLine,
        "🕑 Se enviaron botones de servicio; esperando la selección del cliente."
      ], from);

      return res.sendStatus(200);
    }

    // Si pasaron más de 15 minutos, resetear el flag de humano
    if (timeSinceLastMessage > 15 * 60 * 1000 && conversationContext.isHumanHandling) {
      conversationContext.isHumanHandling = false;
    }

    // Refrescar contexto antes de verificar (por si el botón lo cambió)
    conversationContext = (await getConversationState(from)) || conversationContext;

    console.log(`🔍 Estado actual para ${from}:`, {
      isHumanHandling: conversationContext?.isHumanHandling,
      timeSinceLastMessage: Math.floor(timeSinceLastMessage / 1000) + 's'
    });
    // Emergencia
    const isEmergency = emergencyKeywords.some(k => text.toLowerCase().includes(k));
    if (isEmergency) {
      console.log(`🚨 EMERGENCIA detectada de ${from}`);
      await sendWhatsAppText(from, crisisMessage);
      await sendVoiceNoteIfEnabled(from, crisisMessage, "emergency");
      await notifyTelegram("🚨 EMERGENCIA DETECTADA", [incomingTelegramLine, "⚠️ Protocolo enviado. IA bloqueada."], from);
      await saveMeta({ phone: from, emergency: true, required_human: true });

      await mergeConversationState(from, {
        lastMessageTime: Date.now(),
        isHumanHandling: true,
        awaitingScheduling: false
      });

      return res.sendStatus(200);
    }

    // Detectar mensajes de seguimiento/insistencia
    const followUpPattern = /^(hola[\?!]*|h+o+l+a+[\?!]*|ey|oye|hey|est[aá]s|me escuchas|sigues ah[ií])[\?!]*$/i;
    const isFollowUp = followUpPattern.test(text.trim());

    if (isFollowUp && conversationContext) {
      console.log(`👋 Mensaje de seguimiento detectado de ${from}`);

      const responses = [
        "¡Aquí estoy! 😊 ¿En qué más puedo ayudarte?",
        "¡Sí, aquí estoy! ¿Qué necesitas saber? 😊",
        "¡Presente! 💙 ¿En qué más te puedo ayudar?"
      ];

      const response = responses[Math.floor(Math.random() * responses.length)];

      await sendWhatsAppText(from, response);
      await notifyTelegram("👋 Mensaje de seguimiento", [incomingTelegramLine], from);

      await mergeConversationState(from, {
        lastMessageTime: Date.now()
      });

      return res.sendStatus(200);
    }

    // Quick answers con contexto
    const quick = quickAnswers(text, conversationContext);
    if (quick) {
      console.log(`⚡ Quick answer para ${from}`);
      await sendWhatsAppText(from, quick);
      await sendVoiceNoteIfEnabled(from, quick, "quick");
      await notifyTelegram("✅ Respondido automático (Quick)", [incomingTelegramLine], from);
      await saveMeta({ phone: from });

      await mergeConversationState(from, {
        lastMessageTime: Date.now(),
        isHumanHandling: false,
        awaitingScheduling: false
      });

      return res.sendStatus(200);
    }

    // Si un humano está manejando, NO responder con IA
    if (conversationContext?.isHumanHandling) {
      console.log(`👤 Conversación en modo HUMANO para ${from}, solo notificando...`);
      await notifyTelegram("💬 NUEVO MENSAJE (en conversación activa)", [incomingTelegramLine], from);
      await saveMeta({ phone: from, required_human: true });

      // Actualizar timestamp
      await mergeConversationState(from, {
        lastMessageTime: Date.now()
      });

      return res.sendStatus(200);
    }

    // Si llegamos aquí, la IA puede responder
    console.log(`🤖 IA habilitada para ${from}, consultando...`);

    // IA (Gemini)
    console.log(`🤖 Consultando IA para mensaje de ${from}`);
    const { message: aiMessage, meta } = await generateAIReply({
      text,
      conversationContext,
      phone: from
    });

    // Agregar link de Calendly solo para terapia (deshabilitado temporalmente)
    let finalMessage = aiMessage;
    // if (meta?.intent === 'agendar' && meta?.service === 'therapy') {
    //   const calendlyUrl = process.env.CALENDLY_THERAPY_URL;
    //
    //   if (calendlyUrl) {
    //     finalMessage += `\n\n📅 Agenda aquí tu cita de terapia psicológica:\n${calendlyUrl}`;
    //     console.log(`📅 Link de Calendly agregado para terapia`);
    //   }
    // }

    // Si es PSIQUIATRÍA, derivar a humano (no enviar link)
    if (meta?.intent === 'agendar' && meta?.service === 'psychiatry') {
      finalMessage += `\n\n👤 Para coordinar tu consulta psiquiátrica, un miembro de nuestro equipo te contactará en breve para confirmar disponibilidad.`;
      meta.notify_human = true;
      console.log(`👤 Consulta psiquiátrica detectada - derivando a humano`);
    }

    console.log(`🤖 IA respondió | intent: ${meta?.intent} | priority: ${meta?.priority} | notify: ${meta?.notify_human}`);

    // Notifica a Telegram
    const fullAIResponse = finalMessage || "";
    const aiPreview = fullAIResponse.slice(0, 500);
    const aiSuffix = fullAIResponse.length > aiPreview.length ? "…" : "";
    await notifyTelegram("🔔 NUEVO MENSAJE", [
      incomingTelegramLine,
      `🤖 IA: intent=${meta?.intent} priority=${meta?.priority} notify=${meta?.notify_human}`,
      `🧠 Respuesta IA: "${aiPreview}${aiSuffix}"`
    ], from);

    // Decide si auto-responder
    const requiresHuman = !!meta?.notify_human;

    await saveMeta({ phone: from, required_human: requiresHuman });

    // Actualizar contexto de conversación
    const isSchedulingIntent = ['agendar', 'scheduling', 'appointment'].includes(meta?.intent);

    await mergeConversationState(from, {
      lastMessageTime: Date.now(),
      // isHumanHandling: requiresHuman, // No activar silencio hasta que el humano responda
      awaitingScheduling: !requiresHuman && isSchedulingIntent,
      lastIntent: meta?.intent,
      context: text
    });

    const trimmedFinalMessage = (finalMessage || "").trim();
    if (trimmedFinalMessage) {
      console.log(`🤖 Enviando respuesta IA a ${from} (notify_human=${requiresHuman})`);
      await sendWhatsAppText(from, trimmedFinalMessage);
      await sendVoiceNoteIfEnabled(from, trimmedFinalMessage, "ai");
    } else {
      console.log(`⚠️ Mensaje IA vacío para ${from}, no se envía a WhatsApp`);
    }

    if (requiresHuman) {
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

  await deleteConversationState(phone);

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

  const now = Date.now();
  const conversations = (await listActiveConversations()).map(({ phone, state, updatedAt }) => ({
    phone,
    isHumanHandling: state.isHumanHandling,
    awaitingScheduling: state.awaitingScheduling,
    lastIntent: state.lastIntent,
    minutesSinceLastMessage: Math.floor((now - (state.lastMessageTime || updatedAt)) / 60000)
  }));

  return res.json({
    total: conversations.length,
    metrics: getStateMetrics(),
    conversations
  });
});

app.get("/admin/state-metrics", async (req, res) => {
  const { admin_key } = req.query;

  if (admin_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: "No autorizado" });
  }

  await listActiveConversations();

  return res.json({
    ...getStateMetrics(),
  });
});

// Export para Vercel / local
if (VERCEL !== "1") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🚀 Local http://localhost:${port}`));
}

export default (req, res) => app(req, res);
