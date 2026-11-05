import { loadConfig } from "./intake/core/config.js";
import { processPatientIntake } from "./intake/services/intake-orchestrator.js";

export function isIntakeMessage({ text, from, env = process.env }) {
  if (!text || !from) return false;

  // REGLA FUNDAMENTAL: Solo la psicóloga o administradores autorizados.
  // NUNCA interactuar con pacientes para este flujo.
  // 51922346747: Psicóloga Feliz Horizonte
  // 51936597327: Emerson Madrid
  const authorizedPhones = (env.AUTHORIZED_STAFF_PHONES || "51922346747,51936597327")
    .split(",")
    .map(p => p.trim().replace(/\D/g, ""))
    .filter(Boolean);

  const cleanFrom = String(from).replace(/\D/g, "");
  const isStaff = authorizedPhones.some(phone => cleanFrom.includes(phone) || phone.includes(cleanFrom));

  if (!isStaff) {
    // Si NO es la psicóloga o staff, NO es admisión de paciente. Dejar pasar al bot normal.
    return false;
  }

  const cleanBody = text.toLowerCase();

  // 1. Comando explícito
  if (
    cleanBody.startsWith('#alta') ||
    cleanBody.startsWith('#registro') ||
    cleanBody.startsWith('/alta') ||
    cleanBody.startsWith('/registro')
  ) {
    return true;
  }

  // 2. Patrón estructurado de ficha de paciente (ej: ✅ Nombre completo: ...)
  const hasName =
    cleanBody.includes('nombre completo:') ||
    cleanBody.includes('nombre:') ||
    cleanBody.includes('✅ nombre');

  const hasPhoneOrDate =
    cleanBody.includes('celular:') ||
    cleanBody.includes('teléfono:') ||
    cleanBody.includes('telefono:') ||
    cleanBody.includes('nacimiento:');

  if (hasName && hasPhoneOrDate) {
    return true;
  }

  return false;
}

export async function forwardToIntakeService({ text, from, env = process.env }) {
  const intakeUrl = env.INTAKE_SERVICE_URL;

  // Si hay un microservicio externo configurado en URL pública, reenviar por HTTP
  if (intakeUrl && !intakeUrl.includes('localhost')) {
    console.log(`📡 Reenviando admisión al microservicio externo: ${intakeUrl}`);
    try {
      const res = await fetch(`${intakeUrl}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.INTAKE_API_KEY || 'fh_intake_dev_secret_key_2026'}`
        },
        body: JSON.stringify({
          text,
          from,
          senderName: 'WhatsApp Staff Forward'
        })
      });
      return await res.json();
    } catch (err) {
      console.error('❌ Error llamando al microservicio externo, ejecutando fallback local:', err.message);
    }
  }

  // Ejecución directa in-process con las credenciales activas del bot en Vercel
  console.log(`🚀 Ejecutando admisión de paciente in-process para: ${from}`);
  try {
    const config = loadConfig(env);
    const result = await processPatientIntake({
      text,
      from,
      senderName: 'Psicóloga Feliz Horizonte',
      config
    });
    console.log('✅ Admisión completada:', result.success);
    return { ok: result.success, data: result };
  } catch (err) {
    console.error('❌ Error procesando admisión in-process:', err);
    return { ok: false, error: err.message };
  }
}
