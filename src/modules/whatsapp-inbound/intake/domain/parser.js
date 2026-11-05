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

export async function parsePatientFromText(text, config) {
  if (!text || !text.trim()) {
    throw new Error('Texto de entrada vacío');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: text }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        { text: SYSTEM_INSTRUCTION }
      ]
    },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error llamando a Gemini (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const rawJson = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error('Gemini no devolvió contenido estructurado');
  }

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
