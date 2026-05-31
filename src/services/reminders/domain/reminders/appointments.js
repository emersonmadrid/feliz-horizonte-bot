import { getPostgresPool } from "../../integrations/postgres/client.js";
import { isTodayAtHour, isWithinLeadWindow } from "../../core/time.js";
import {
  ensureReminderStateTable,
  fetchEligibleReminderAppointments,
} from "../../persistence/appointments.js";
import { listGoogleReminderAppointments } from "../../sources/google-appointments.js";
import { syncCalendlyApiAppointments } from "../../sources/calendly-appointments.js";

async function fetchPendingAppointments(config) {
  if (config.appointmentSource === "google") {
    return listGoogleReminderAppointments(config);
  }

  if (config.appointmentSource === "hybrid") {
    await listGoogleReminderAppointments(config);
    return fetchEligibleReminderAppointments(config);
  }

  if (config.appointmentSource === "calendly_api") {
    await syncCalendlyApiAppointments(config);
    return fetchEligibleReminderAppointments(config);
  }

  if (config.appointmentSource !== "calendly") {
    throw new Error(`Unsupported APPOINTMENT_SOURCE: ${config.appointmentSource}`);
  }

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for reminder state tracking");
  }

  return fetchEligibleReminderAppointments(config);
}

export async function listReminderAppointments(config) {
  const appointments = await fetchPendingAppointments(config);

  return appointments.sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

export function filterAppointmentsForDayReminder(config, appointments) {
  return appointments.filter((appointment) => {
    if (appointment.dayReminderSentAt) return false;
    return isTodayAtHour(
      appointment.startsAt,
      appointment.timezone || config.timezone,
      config.dayReminderHour
    );
  });
}

export function filterAppointmentsForHourReminder(config, appointments) {
  return appointments.filter((appointment) => {
    if (appointment.hourReminderSentAt) return false;
    return isWithinLeadWindow(
      appointment.startsAt,
      config.hourReminderLeadMinutes,
      config.hourReminderWindowMinutes
    );
  });
}

export async function findAppointmentsForDayReminder(config) {
  const appointments = await listReminderAppointments(config);
  return filterAppointmentsForDayReminder(config, appointments);
}

export async function findAppointmentsForHourReminder(config) {
  const appointments = await listReminderAppointments(config);
  return filterAppointmentsForHourReminder(config, appointments);
}

export async function markReminderSent(config, appointmentId, type) {
  await ensureReminderStateTable(config);
  const pool = getPostgresPool(config);
  const column = type === "day" ? "day_sent_at" : "hour_sent_at";

  await pool.query(
    `
      insert into whatsapp_reminder_state (appointment_id, ${column})
      values ($1, now())
      on conflict (appointment_id)
      do update set ${column} = now(), updated_at = now()
    `,
    [appointmentId]
  );
}
