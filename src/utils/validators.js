// src/utils/validators.js

/**
 * Lista de palabras ofensivas a bloquear
 */
const OFFENSIVE_WORDS = [
  'chucha', 'mierda', 'carajo', 'huevón', 'conchatumadre', 'ctm',
  'puta', 'verga', 'cojudo', 'imbécil', 'idiota', 'estúpido',
  'pendejo', 'gil', 'boludo', 'sonso', 'tarado'
];

/**
 * Palabras clave que indican una emergencia
 */
const EMERGENCY_KEYWORDS = [
  "no quiero vivir", "quiero terminar con todo", "me quiero morir",
  "no vale la pena", "quiero hacerme daño", "pensamientos suicidas",
  "suicid", "matarme", "quitarme la vida"
];

/**
 * Verifica si un texto contiene lenguaje ofensivo
 * @param {string} text - Texto a verificar
 * @returns {boolean} - true si contiene palabras ofensivas
 */
export function containsOffensiveLanguage(text) {
  if (!text || typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  return OFFENSIVE_WORDS.some(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(lowerText);
  });
}

/**
 * Verifica si un texto indica una situación de emergencia
 * @param {string} text - Texto a verificar
 * @returns {boolean} - true si es una emergencia
 */
export function isEmergency(text) {
  if (!text || typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

/**
 * Valida que un número de teléfono tenga formato correcto
 * @param {string} phone - Número de teléfono
 * @returns {boolean} - true si es válido
 */
export function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  // Acepta números con al menos 8 dígitos
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 8 && cleaned.length <= 15;
}

/**
 * Verifica si un mensaje es un comando
 * @param {string} text - Texto a verificar
 * @returns {boolean} - true si es un comando
 */
export function isCommand(text) {
  if (!text || typeof text !== 'string') return false;
  return text.trim().startsWith('/');
}