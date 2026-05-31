import { loadConfig, validateCronSecret } from "../../src/services/reminders/core/config.js";
import { runReminderEngine } from "../../src/services/reminders/domain/reminders/engine.js";

function isDryRunRequest(req) {
  const value = req.query?.dry_run || req.query?.dryRun;
  return ["true", "1", "yes", "on"].includes(String(value || "").toLowerCase());
}

export default async function handler(req, res) {
  console.log("⏰ Iniciando ejecución de recordatorios vía Cron...");
  
  if (!validateCronSecret(req)) {
    console.warn("⚠️ Intento de ejecución no autorizado en Cron");
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    console.log("⚙️ Cargando configuración...");
    const config = loadConfig();
    if (isDryRunRequest(req)) {
      config.remindersDryRun = true;
    }

    // CAPA DE SIMULACIÓN PARA PRUEBAS (Costo 0)
    let mockedAppointments = null;
    if (process.env.TEST_MODE_ENABLED === "true") {
      console.log("🧪 MODO TEST: Inyectando cita simulada...");
      mockedAppointments = {
        hour: [{
          id: "test-appointment-" + Date.now(),
          patientName: "Paciente de Prueba (Simulación)",
          patientPhone: "51901689531",
          startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          status: "scheduled"
        }]
      };
    }

    console.log("🚀 Ejecutando motor de recordatorios...");
    const result = await runReminderEngine(config, mockedAppointments);
    console.log("✅ Ejecución finalizada con éxito");
    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error en Cron Reminders:", error.message);
    console.error(error.stack);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
