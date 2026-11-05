export function isIntakeMessage({ text, from, env = process.env }) {
  if (!text || !from) return false;

  // REGLA FUNDAMENTAL: Solo la psicóloga o administradores autorizados.
  // NUNCA interactuar con pacientes para este flujo.
  const authorizedPhones = (env.AUTHORIZED_STAFF_PHONES || "51922346747,51950293393")
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
  const intakeUrl = env.INTAKE_SERVICE_URL || 'http://localhost:3005';
  const apiKey = env.INTAKE_API_KEY || 'fh_intake_dev_secret_key_2026';

  console.log(`📡 Reenviando mensaje de admisión a ${intakeUrl}/api/ingest desde ${from}`);

  try {
    const res = await fetch(`${intakeUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        text,
        from,
        senderName: 'WhatsApp Staff Forward'
      })
    });

    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    console.error('❌ Error comunicando con microservicio de admisión:', err.message);
    return { ok: false, error: err.message };
  }
}
