// src/services/conversation-history.service.js
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  CONVERSATION_HISTORY_TABLE,
  CONVERSATION_HISTORY_MAX_MESSAGES,
} = process.env;

const HISTORY_TABLE = CONVERSATION_HISTORY_TABLE || "fh_conversation_history";
const MAX_MESSAGES = Number(CONVERSATION_HISTORY_MAX_MESSAGES || 20);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Guarda un mensaje en el historial de conversación
 */
export async function saveMessage({ phone, role, content, intent = null, service = null }) {
  if (!phone || !role || !content) {
    console.warn("⚠️ Intento de guardar mensaje incompleto:", { phone, role, content });
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .insert([{
        phone,
        role,
        content: content.substring(0, 5000), // Limitar a 5000 chars
        intent,
        service
      }])
      .select()
      .single();

    if (error) throw error;
    console.log(`💾 Mensaje guardado: ${phone} (${role})`);
    return data;
  } catch (err) {
    console.error("❌ Error guardando mensaje en historial:", err.message);
    return null;
  }
}

/**
 * Recupera el historial de conversación de un teléfono
 */
export async function getConversationHistory(phone, limit = MAX_MESSAGES) {
  if (!phone) return [];

  try {
    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .select("role, content, intent, service, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Invertir para tener orden cronológico
    return (data || []).reverse();
  } catch (err) {
    console.error("❌ Error recuperando historial:", err.message);
    return [];
  }
}

/**
 * Formatea el historial para usarlo como contexto en el prompt
 */
export function formatHistoryForPrompt(history) {
  if (!history || history.length === 0) {
    return "";
  }

  let contextPrompt = "\n\nCONTEXTO DE CONVERSACIÓN PREVIA:\n";
  
  history.forEach((msg, idx) => {
    const roleLabel = msg.role === 'user' ? 'Cliente' : 'Tú';
    const preview = msg.content.length > 200 
      ? msg.content.substring(0, 200) + "..." 
      : msg.content;
    
    contextPrompt += `${roleLabel}: "${preview}"\n`;
    
    if (msg.intent && idx === history.length - 1) {
      contextPrompt += `  └─ Última intención detectada: ${msg.intent}\n`;
    }
  });

  contextPrompt += "\n⚠️ IMPORTANTE: NO repitas lo que ya dijiste. Si el cliente ya eligió el servicio, AVANZA hacia el agendamiento.\n";
  
  return contextPrompt;
}

/**
 * Elimina el historial de un teléfono
 */
export async function deleteConversationHistory(phone) {
  if (!phone) return;

  try {
    const { error } = await supabase
      .from(HISTORY_TABLE)
      .delete()
      .eq("phone", phone);

    if (error) throw error;
    console.log(`🗑️ Historial eliminado: ${phone}`);
  } catch (err) {
    console.error("❌ Error eliminando historial:", err.message);
  }
}

/**
 * Obtiene estadísticas del historial
 */
export async function getHistoryStats(phone) {
  if (!phone) return null;

  try {
    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .select("role, intent, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const totalMessages = data?.length || 0;
    const userMessages = data?.filter(m => m.role === 'user').length || 0;
    const lastIntent = data?.[0]?.intent || null;
    const firstMessageDate = data?.[data.length - 1]?.created_at || null;

    return {
      totalMessages,
      userMessages,
      assistantMessages: totalMessages - userMessages,
      lastIntent,
      firstMessageDate,
      conversationAge: firstMessageDate 
        ? Math.floor((Date.now() - new Date(firstMessageDate).getTime()) / 60000) 
        : 0 // en minutos
    };
  } catch (err) {
    console.error("❌ Error obteniendo estadísticas:", err.message);
    return null;
  }
}

/**
 * Limpia conversaciones antiguas (llamar manualmente o con cron)
 */
export async function cleanupOldConversations(daysOld = 7) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .delete()
      .lt("created_at", cutoffDate.toISOString())
      .select("phone");

    if (error) throw error;

    const uniquePhones = new Set(data?.map(d => d.phone) || []);
    console.log(`🧹 Limpieza completada: ${data?.length || 0} mensajes de ${uniquePhones.size} conversaciones`);
    
    return {
      messagesDeleted: data?.length || 0,
      conversationsAffected: uniquePhones.size
    };
  } catch (err) {
    console.error("❌ Error limpiando conversaciones antiguas:", err.message);
    return null;
  }
}