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
    config.geminiModel || 'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
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

const SYSTEM_INSTRUCTION_CLINICAL = `Eres el asistente clínico de registros y evolución médica del Centro Psicológico y Psiquiátrico 'Feliz Horizonte'.
Tu labor es interpretar mensajes del personal médico (psicólogos/psiquiatras) que relatan una sesión de terapia, consulta o evolución clínica de un paciente para registrarla formalmente en su Historia Clínica.

Debes responder ÚNICAMENTE con un objeto JSON con los siguientes campos:
- "target": El identificador del paciente provisto en el mensaje (ej: "188", "191", o número de celular si aplica). Si no se indica, null.
- "fecha": Fecha de la consulta si se menciona explícitamente en el texto; si no, null.
- "motivo": Motivo principal de la consulta o lo que el paciente relata en la sesión (resumido de forma clara y profesional).
- "sintomas": Síntomas observados o manifestados (ej: impulsos sexuales descontrolados, pensamientos obsesivos, aislamiento social, baja tolerancia a la frustración, etc.).
- "diagnostico": Diagnóstico presuntivo o conclusión clínica si se menciona; si no, cadena vacía.
- "tratamiento": Técnicas aplicadas en la sesión (ej: TREC, técnica de coste-beneficio, activación conductual), tareas asignadas, material enviado o plan terapéutico.
- "observaciones": Observaciones clínicas del terapeuta, examen mental o conducta observada (ej: historia familiar, creencias irracionales de condena, rigidez cognitiva).
- "signos": Signos psicopatológicos o de conducta observados si se desprenden; si no, cadena vacía.
- "medico": Nombre del profesional si se menciona explícitamente en el texto; si no, null.`;

export async function parseClinicalHistoryFromText(text, config) {
  if (!text || !text.trim()) {
    throw new Error('Texto de entrada vacío');
  }

  const rawJson = await callGeminiGenerate({
    prompt: text,
    systemInstruction: SYSTEM_INSTRUCTION_CLINICAL,
    config
  });

  const parsed = JSON.parse(rawJson);

  let target = parsed.target ? String(parsed.target).trim() : null;
  // Respaldo regex para extraer target si el LLM lo omitió
  if (!target) {
    const m = text.match(/(?:#|\/)?(?:historia|consulta|sesion|sesión|evolucion|evolución|actualizar|modificar|agregar)\s+(\d{1,9})/i);
    if (m) target = m[1];
  }

  return {
    target: target,
    fecha: parsed.fecha ? String(parsed.fecha).trim() : null,
    motivo: parsed.motivo ? String(parsed.motivo).trim() : '',
    sintomas: parsed.sintomas ? String(parsed.sintomas).trim() : '',
    diagnostico: parsed.diagnostico ? String(parsed.diagnostico).trim() : '',
    tratamiento: parsed.tratamiento ? String(parsed.tratamiento).trim() : '',
    observaciones: parsed.observaciones ? String(parsed.observaciones).trim() : '',
    signos: parsed.signos ? String(parsed.signos).trim() : '',
    medico: parsed.medico ? String(parsed.medico).trim() : null
  };
}

const SYSTEM_INSTRUCTION_STAFF_ASSISTANT = `Eres la Asistente Clínica y Secretaria Ejecutiva de Inteligencia Artificial del Centro Psicológico y Psiquiátrico 'Feliz Horizonte'.
Tu usuario es el personal médico autorizado (psicólogos, directores).
Tu misión es interpretar CUALQUIER mensaje en lenguaje natural enviado por el personal y extraer la acción e información estructurada con máxima fidelidad.

Debes responder ÚNICAMENTE con un objeto JSON con los siguientes campos:

- "intent": Uno de los siguientes valores exactos:
  * "HISTORIA_CLINICA": Si el mensaje describe o relata una sesión de terapia, consulta psicológica/médica, evolución de paciente, lo que refirió en consulta, síntomas trabajados, técnicas o intervenciones aplicadas (ej: TREC, activación conductual, relajación), tareas dejadas o notas clínicas.
  * "ACTUALIZAR_DATOS": Si el mensaje pide actualizar, agregar o modificar datos de contacto o personales de un paciente existente (DNI, trabajo/ocupación, correo, dirección, teléfono nuevo, estado civil, grado de instrucción).
  * "NUEVO_PACIENTE": Si el mensaje contiene datos de contacto para dar de alta a un NUEVO paciente (nombres, apellidos, celular, correo, fecha de nacimiento) o un mensaje/chat reenviado de admisión.
  * "AYUDA_O_SALUDO": Si el mensaje es un saludo (hola, buenos días, etc.), una consulta general sobre qué puede hacer, o pide el menú/ayuda.

- "target": Nombre, ID o celular del paciente referido en el mensaje (ej: "Kevin Vásquez", "Kevin", "188", "#128", "128", "Valeria Mendoza", "Emerson Madrid"). Si se indica un ID con # (ej: "#128"), el target es "128". Si es un alta de paciente nuevo o no se identifica, null.

- "historia": Si el intent es "HISTORIA_CLINICA", objeto con:
  * "motivo": Resumen claro de lo que refiere el paciente o motivo de la sesión.
  * "sintomas": Síntomas descritos u observados (ej: impulsos voyeristas, ansiedad, baja tolerancia).
  * "diagnostico": Diagnóstico presuntivo o conclusión clínica si se menciona; si no, cadena vacía.
  * "tratamiento": Técnicas aplicadas en la sesión (ej: TREC, coste-beneficio), tareas asignadas o plan terapéutico.
  * "observaciones": Examen mental, historia familiar relevante, creencias irracionales o notas del terapeuta.
  * "signos": Signos psicopatológicos o de conducta observados si se desprenden; si no, cadena vacía.
  * "medico": Nombre del médico si se menciona explícitamente; si no, null.
  (Si el intent no es HISTORIA_CLINICA, null).

- "actualizacion": Si el intent es "ACTUALIZAR_DATOS", objeto con los campos a modificar (dni, telefono, email, direccion, trabajo, ocupacion, estadocivil, grado, nombre, apellidos, observaciones). Los que no se mencionen déjalos en null.
  (Si el intent no es ACTUALIZAR_DATOS, null).`;

export async function classifyAndParseStaffMessage(text, config) {
  if (!text || !text.trim()) {
    throw new Error('Texto de entrada vacío');
  }

  const rawJson = await callGeminiGenerate({
    prompt: text,
    systemInstruction: SYSTEM_INSTRUCTION_STAFF_ASSISTANT,
    config
  });

  const parsed = JSON.parse(rawJson);

  let target = parsed.target ? String(parsed.target).trim().replace(/^#/, '') : null;
  if (!target) {
    const idMatch = text.match(/#(\d{1,5})\b/) || text.match(/\b(?:id|paciente)\s*#?(\d{1,5})\b/i);
    if (idMatch) {
      target = idMatch[1];
    } else {
      const m = text.match(/(?:#|\/)?(?:historia|consulta|sesion|sesión|evolucion|evolución|actualizar|modificar|agregar|paciente)\s*(?:#|de\s+|para\s+|del\s+paciente\s+)?([A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\s]{2,35}?)(?:[:,\.\n]|$)/i);
      if (m) target = m[1].trim();
    }
  }

  const res = {
    intent: parsed.intent || 'AYUDA_O_SALUDO',
    target: target,
    historia: null,
    actualizacion: null
  };

  if (parsed.intent === 'HISTORIA_CLINICA' && parsed.historia) {
    res.historia = {
      target: target,
      fecha: parsed.historia.fecha ? String(parsed.historia.fecha).trim() : null,
      motivo: parsed.historia.motivo ? String(parsed.historia.motivo).trim() : '',
      sintomas: parsed.historia.sintomas ? String(parsed.historia.sintomas).trim() : '',
      diagnostico: parsed.historia.diagnostico ? String(parsed.historia.diagnostico).trim() : '',
      tratamiento: parsed.historia.tratamiento ? String(parsed.historia.tratamiento).trim() : '',
      observaciones: parsed.historia.observaciones ? String(parsed.historia.observaciones).trim() : '',
      signos: parsed.historia.signos ? String(parsed.historia.signos).trim() : '',
      medico: parsed.historia.medico ? String(parsed.historia.medico).trim() : null
    };
  }

  if (parsed.intent === 'ACTUALIZAR_DATOS' && parsed.actualizacion) {
    const a = parsed.actualizacion;
    res.actualizacion = {
      target: target,
      nombre: a.nombre ? capitalizeWords(a.nombre) : null,
      apellidos: a.apellidos ? capitalizeWords(a.apellidos) : null,
      dni: a.dni ? String(a.dni).replace(/\D/g, '') : null,
      fechaNacimiento: a.fechaNacimiento ? normalizeDate(a.fechaNacimiento) : null,
      sexo: a.sexo ? String(a.sexo).toUpperCase() : null,
      telefono: a.telefono ? normalizePhone(a.telefono) : null,
      email: a.email ? normalizeEmail(a.email) : null,
      direccion: a.direccion ? String(a.direccion).trim() : null,
      trabajo: a.trabajo ? String(a.trabajo).trim() : null,
      ocupacion: a.ocupacion ? String(a.ocupacion).trim() : null,
      estadocivil: a.estadocivil ? String(a.estadocivil).trim() : null,
      grado: a.grado ? String(a.grado).trim() : null,
      observaciones: a.observaciones ? String(a.observaciones).trim() : null
    };
  }

  return res;
}
