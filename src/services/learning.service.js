// src/services/learning.service.js
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LEARNED_TABLE = "fh_learned_responses";

/**
 * Extrae keywords relevantes de un texto
 */
function extractKeywords(text) {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Quitar acentos

  const keywords = [];
  
  // Servicios específicos NO ofrecidos
  if (/autis|tea|espectro/.test(normalized)) keywords.push("autismo", "tea");
  if (/neuropsicolog/.test(normalized)) keywords.push("neuropsicologia");
  if (/terapia ocupacional|ocupacional/.test(normalized)) keywords.push("terapia_ocupacional");
  if (/psicopedag|dislexia|tdah|deficit/.test(normalized)) keywords.push("psicopedagogia", "aprendizaje");
  if (/aba|intervenci[oó]n temprana/.test(normalized)) keywords.push("aba", "intervencion_temprana");
  
  // Poblaciones específicas
  if (/ni[ñn]o|infan|pediatr|beb[eé]/.test(normalized)) keywords.push("infantil", "ninos");
  if (/adolescen/.test(normalized)) keywords.push("adolescentes");
  if (/adulto mayor|anciano|tercera edad/.test(normalized)) keywords.push("adultos_mayores");
  if (/lgbt|trans|identidad/.test(normalized)) keywords.push("lgbt", "identidad_genero");
  
  // Problemáticas específicas
  if (/adicci[oó]n|drogas|alcohol|sustancia/.test(normalized)) keywords.push("adicciones");
  if (/violencia|abuso|maltrato/.test(normalized)) keywords.push("violencia", "trauma");
  if (/duelo|muerte|fallecimiento/.test(normalized)) keywords.push("duelo");
  if (/ansiedad|p[áa]nico/.test(normalized)) keywords.push("ansiedad");
  if (/depresi[oó]n/.test(normalized)) keywords.push("depresion");
  if (/pareja|matrimon|divorcio/.test(normalized)) keywords.push("pareja");
  if (/familia|hijo|padre|madre/.test(normalized)) keywords.push("familia");
  
  // Servicios específicos
  if (/evaluaci[oó]n|diagn[oó]stico|test/.test(normalized)) keywords.push("evaluacion");
  if (/online|virtual|zoom/.test(normalized)) keywords.push("online");
  if (/presencial|consultorio|direcci[oó]n/.test(normalized)) keywords.push("presencial");
  if (/precio|costo|tarifa|cu[áa]nto/.test(normalized)) keywords.push("precio");
  if (/horario|hora|d[íi]a|disponibilidad/.test(normalized)) keywords.push("horarios");
  if (/seguro|eps|isapre|cobertura/.test(normalized)) keywords.push("seguros");
  if (/emergencia|urgente|crisis/.test(normalized)) keywords.push("emergencia");
  
  return [...new Set(keywords)]; // Eliminar duplicados
}

/**
 * Guarda una respuesta aprendida del humano
 */
export async function saveLearnedResponse({
  question,
  humanResponse,
  phone,
  agentUsername = null,
  category = "general",
  conversationContext = null
}) {
  try {
    const keywords = extractKeywords(question + " " + humanResponse);
    
    if (keywords.length === 0) {
      console.warn("⚠️ No se encontraron keywords relevantes para aprender");
      return null;
    }

    const { data, error } = await supabase
      .from(LEARNED_TABLE)
      .insert([{
        question_pattern: question.substring(0, 500),
        human_response: humanResponse.substring(0, 2000),
        selected_message: humanResponse.substring(0, 2000),
        conversation_context: conversationContext,
        keywords,
        category,
        phone,
        learned_from_agent: agentUsername,
        confidence_score: 0.9,
        verification_status: 'verified'
      }])
      .select()
      .single();

    if (error) throw error;

    console.log(`🧠 Respuesta aprendida guardada: ${keywords.join(", ")}`);
    return data;
  } catch (err) {
    console.error("❌ Error guardando respuesta aprendida:", err.message);
    return null;
  }
}

/**
 * Busca respuestas aprendidas relevantes para una pregunta
 */
export async function findLearnedResponse(question, limit = 3) {
  try {
    const keywords = extractKeywords(question);
    
    if (keywords.length === 0) {
      return null;
    }

    console.log(`🔍 Buscando respuestas aprendidas para keywords: ${keywords.join(", ")}`);

    const { data, error } = await supabase
      .from(LEARNED_TABLE)
      .select("*")
      .eq("is_active", true)
      .overlaps("keywords", keywords)
      .order("confidence_score", { ascending: false })
      .order("times_used", { ascending: false })
      .limit(limit);

    if (error) throw error;

    if (data && data.length > 0) {
      console.log(`✅ Encontradas ${data.length} respuestas aprendidas`);
      return data[0]; // Retornar la más relevante
    }

    return null;
  } catch (err) {
    console.error("❌ Error buscando respuestas aprendidas:", err.message);
    return null;
  }
}

/**
 * Marca una respuesta aprendida como usada
 */
export async function markResponseUsed(responseId) {
  try {
    const { error } = await supabase.rpc("increment_learned_usage", {
      response_id: responseId
    });

    if (error) throw error;
  } catch (err) {
    console.error("❌ Error marcando respuesta como usada:", err.message);
  }
}

/**
 * Lista respuestas aprendidas para revisión
 */
export async function listLearnedResponses(limit = 50) {
  try {
    const { data, error } = await supabase
      .from(LEARNED_TABLE)
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("❌ Error listando respuestas aprendidas:", err.message);
    return [];
  }
}

/**
 * Desactiva una respuesta aprendida
 */
export async function deactivateLearnedResponse(responseId) {
  try {
    const { error } = await supabase
      .from(LEARNED_TABLE)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", responseId);

    if (error) throw error;
    console.log(`🗑️ Respuesta aprendida ${responseId} desactivada`);
  } catch (err) {
    console.error("❌ Error desactivando respuesta:", err.message);
  }
}
