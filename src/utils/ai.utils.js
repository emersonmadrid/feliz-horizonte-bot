export function sanitizeGeminiApiKey(rawKey) {
  return (rawKey ?? "").trim().replace(/^["']+|["']+$/g, "");
}

export function buildPrompt({ businessPrompt = "", contextPrompt = "", text = "" }) {
  return `${businessPrompt}${contextPrompt}\n\nMensaje actual del cliente:\n"${text}"\n\nRespuesta:`;
}
