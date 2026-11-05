import { parsePatientFromText } from '../domain/parser.js';
import { validatePatient } from '../domain/validator.js';
import { insertPatientRow } from '../integrations/google-sheets.js';
import { sendWhatsAppMessage } from '../integrations/whatsapp.js';

export async function processPatientIntake({ text, from, senderName, config }) {
  console.log(`📥 Procesando admisión de paciente desde: ${from || 'sistema'} (${senderName || ''})`);

  // 1. Extraer datos con Gemini
  const patient = await parsePatientFromText(text, config);
  console.log('🧠 Datos extraídos por IA:', JSON.stringify(patient));

  // 2. Validar datos
  const validation = validatePatient(patient);
  if (!validation.isValid) {
    const errorMsg = `⚠️ No se pudo registrar al paciente por las siguientes razones:\n- ${validation.errors.join('\n- ')}\n\nPor favor corrige el dato y vuelve a enviarlo.`;
    
    if (from) {
      await sendWhatsAppMessage({ to: from, text: errorMsg, config });
    }

    return {
      success: false,
      reason: 'validation_failed',
      errors: validation.errors,
      patient
    };
  }

  // 3. Insertar en Google Sheets
  const creatorLabel = from ? `whatsapp:${from}` : 'whatsapp-intake';
  const result = await insertPatientRow(patient, creatorLabel, config);

  // 4. Preparar respuesta a WhatsApp
  let responseText = '';
  if (result.alreadyExisted) {
    responseText = `ℹ️ Paciente ya registrado: *${result.existingNombre}* (#${result.existingId}).`;
  } else {
    responseText = `✅ Paciente *${result.fullName}* registrado (#${result.id}).`;
  }

  // 5. Enviar mensaje de confirmación por WhatsApp si hay remitente
  if (from) {
    await sendWhatsAppMessage({ to: from, text: responseText, config });
  }

  return {
    success: true,
    result,
    patient,
    responseText
  };
}
