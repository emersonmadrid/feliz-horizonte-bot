import { normalizePhone, normalizeEmail, capitalizeWords, normalizeDate } from '../core/normalizers.js';

const SYSTEM_INSTRUCTION = `Eres el asistente clínico de admisión del Centro Psicológico y Psiquiátrico 'Feliz Horizonte'.
Tu tarea es leer mensajes de WhatsApp enviados por pacientes o reenviados por la psicóloga/secretaria y extraer con máxima precisión los datos para la ficha clínica del paciente.

Debes responder ÚNICAMENTE con un objeto JSON válido con los siguientes campos:
- "nombre": Nombres de pila (ej: "Karen Natali").
- "apellidos": Apellidos paterno y materno (ej: "Roque González").
- "dni": DNI de 8 dígitos si existe, o null si no se menciona.
- "fechaNacimiento": Fecha en formato YYYY-MM-DD (ej: "2001-07-14"). Si la fecha está en texto como "14 de julio del 2001", conviértela a YYYY-MM-DD.
- "sexo": "F" para femenino o "M" para masculino (infiéredelo del nombre si es evidente, ej. Karen -> "F", o null si dudas).
- "telefono": Número de celular (9 dígitos en Perú, ej: "902043299").
- "email": Correo electrónico en minúsculas.
- "direccion": Dirección si se indica, o null.
- "trabajo": Ocupación o puesto de trabajo (ej: "Trabajo en laboratorio").
- "estadocivil": "Soltero(a)", "Casado(a)", etc., si se indica, o null.
- "grado": Grado de instrucción si se indica, o null.
- "codigoLead": Si encuentras un código de lead de Feliz Horizonte que comience con FH (ej: FH1234, FHABC), extráelo aquí; si no, null.
- "observaciones": Cualquier detalle extra relevante o null.`;

const SYSTEM_INSTRUCTION_UPDATE = `Eres el asistente clínico de admisión del Centro Psicológico y Psiquiátrico 'Feliz Horizonte'.
Tu labor es interpretar mensajes del personal médico que solicitan ACTUALIZAR o MODIFICAR la ficha de un paciente existente.

Debes responder ÚNICAMENTE con un objeto JSON válido con los siguientes campos:
- "target": El identificador del paciente provisto en el mensaje. Puede ser el ID numérico (ej: "192", "191"), su número de celular actual (ej: "955443322") o su nombre si no hay número. Si no se puede determinar, pon null.
- "dni": DNI de 8 dígitos si se menciona, o null.
- "fechaNacimiento": Fecha en formato YYYY-MM-DD si se menciona, o null.
- "sexo": "F" o "M" si se menciona o infiere con certeza, o null.
- "telefono": Número de celular nuevo (9 dígitos) si se pide cambiar o actualizar el teléfono, o null.
- "email": Correo electrónico en minúsculas si se menciona, o null.
- "direccion": Dirección física si se menciona, o null.
- "trabajo": Ocupación, puesto o trabajo si se menciona, o null.
- "ocupacion": Ocupación si se menciona, o null.
- "estadocivil": Estado civil si se menciona, o null.
- "grado": Grado de instrucción si se menciona, o null.
- "nombre": Nombres si se pide corregir, o null.
- "apellidos": Apellidos si se pide corregir, o null.
- "observaciones": Notas o motivo nuevo si se menciona, o null.

SOLO asigna valor a los campos que el mensaje pide explícitamente agregar o actualizar. Todo lo demás déjalo en null.`;

async function callGeminiGenerate({ prompt, systemInstruction, config }) {
  const models = [
    config.geminiModel || 'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash'
  ];
  const uniqueModels = [...new Set(models)];

  let lastError = null;
  for (const model of uniqueModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 429 || res.status === 404 || res.status === 503) {
          console.warn(`⚠️ Modelo ${model} respondió ${res.status}. Probando fallback...`);
          lastError = new Error(`Error en ${model} (${res.status}): ${errorText}`);
          continue;
        }
        throw new Error(`Error llamando a Gemini con modelo ${model} (${res.status}): ${errorText}`);
      }

      const result = await res.json();
      const rawJson = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawJson) {
        return rawJson;
      }
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Fallo llamada con ${model}:`, err.message);
    }
  }

  throw lastError || new Error('No se pudo obtener respuesta de ningún modelo Gemini configurado');
}

export async function parsePatientFromText(text, config) {
  if (!text || !text.trim()) {
    throw new Error('Texto de entrada vacío');
  }

  const rawJson = await callGeminiGenerate({
    prompt: text,
    systemInstruction: SYSTEM_INSTRUCTION,
    config
  });

  const parsed = JSON.parse(rawJson);

  return {
    nombre: capitalizeWords(parsed.nombre || ''),
    apellidos: capitalizeWords(parsed.apellidos || ''),
    dni: parsed.dni ? String(parsed.dni).replace(/\D/g, '') : '',
    fechaNacimiento: normalizeDate(parsed.fechaNacimiento || ''),
    sexo: (parsed.sexo || '').toUpperCase(),
    telefono: normalizePhone(parsed.telefono || ''),
    email: normalizeEmail(parsed.email || ''),
    direccion: parsed.direccion ? String(parsed.direccion).trim() : '',
    trabajo: parsed.trabajo ? String(parsed.trabajo).trim() : '',
    estadocivil: parsed.estadocivil ? String(parsed.estadocivil).trim() : '',
    grado: parsed.grado ? String(parsed.grado).trim() : '',
    codigoLead: parsed.codigoLead ? String(parsed.codigoLead).trim().toUpperCase() : '',
    observaciones: parsed.observaciones || ''
  };
}

export async function parsePatientUpdateFromText(text, config) {
  if (!text || !text.trim()) {
    throw new Error('Texto de entrada vacío');
  }

  const rawJson = await callGeminiGenerate({
    prompt: text,
    systemInstruction: SYSTEM_INSTRUCTION_UPDATE,
    config
  });

  const parsed = JSON.parse(rawJson);

  let target = parsed.target ? String(parsed.target).trim() : null;
  // Respaldo regex para extraer target si el LLM lo omitió
  if (!target) {
    const m = text.match(/(?:#|\/)?(?:actualizar|modificar|agregar|update)\s+(\d{1,9})/i);
    if (m) target = m[1];
  }

  return {
    target: target,
    nombre: parsed.nombre ? capitalizeWords(parsed.nombre) : null,
    apellidos: parsed.apellidos ? capitalizeWords(parsed.apellidos) : null,
    dni: parsed.dni ? String(parsed.dni).replace(/\D/g, '') : null,
    fechaNacimiento: parsed.fechaNacimiento ? normalizeDate(parsed.fechaNacimiento) : null,
    sexo: parsed.sexo ? String(parsed.sexo).toUpperCase() : null,
    telefono: parsed.telefono ? normalizePhone(parsed.telefono) : null,
    email: parsed.email ? normalizeEmail(parsed.email) : null,
    direccion: parsed.direccion ? String(parsed.direccion).trim() : null,
    trabajo: parsed.trabajo ? String(parsed.trabajo).trim() : null,
    ocupacion: parsed.ocupacion ? String(parsed.ocupacion).trim() : null,
    estadocivil: parsed.estadocivil ? String(parsed.estadocivil).trim() : null,
    grado: parsed.grado ? String(parsed.grado).trim() : null,
    observaciones: parsed.observaciones ? String(parsed.observaciones).trim() : null
  };
}
