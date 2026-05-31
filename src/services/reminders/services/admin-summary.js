import {
  filterAppointmentsForDayReminder,
  filterAppointmentsForHourReminder,
  listReminderAppointments,
} from "../domain/reminders/appointments.js";
import {
  evaluateDailyLimit,
  evaluateMessageLimit,
  getDailyUsage,
  getMonthlyUsage,
} from "../persistence/usage-limits.js";
import {
  fetchRecentMessageLog,
  fetchTodayMessageLogStats,
} from "../persistence/message-log.js";
import { fetchAppointmentOperationalSummary } from "../persistence/appointments.js";
import {
  fetchRecentInboundAudit,
  fetchTodayInboundAuditStats,
} from "../../../modules/whatsapp-inbound/inbound-audit.js";

function summarizeAppointment(appointment) {
  return {
    id: appointment.id,
    patientName: appointment.patientName,
    patientEmail: appointment.patientEmail,
    patientPhone: appointment.patientPhone,
    startsAt: appointment.startsAt,
    status: appointment.status,
    dayReminderSentAt: appointment.dayReminderSentAt,
    hourReminderSentAt: appointment.hourReminderSentAt,
  };
}

function sanitizeLogRow(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    reminderType: row.reminder_type,
    templateName: row.template_name,
    patientName: row.patient_name,
    patientEmail: row.patient_email,
    patientPhone: row.patient_phone,
    startsAt: row.starts_at,
    status: row.status,
    skipReason: row.skip_reason,
    errorMessage: row.error_message,
    providerMessageId: row.provider_message_id,
    createdAt: row.created_at,
  };
}

function sanitizeInboundAuditRow(row) {
  return {
    id: row.id,
    phone: row.phone,
    messageText: row.message_text,
    messageType: row.message_type,
    route: row.route,
    action: row.action,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function buildAdminSummary(config) {
  const dailyUsage = await getDailyUsage(config);
  const monthlyUsage = await getMonthlyUsage(config);
  const [
    todayStats,
    recentLogs,
    allAppointments,
    appointmentOps,
    inboundStats,
    recentInbound,
  ] = await Promise.all([
    fetchTodayMessageLogStats(config),
    fetchRecentMessageLog(config, 20),
    listReminderAppointments(config),
    fetchAppointmentOperationalSummary(config),
    fetchTodayInboundAuditStats(config),
    fetchRecentInboundAudit(config, 20),
  ]);
  const dayEligible = filterAppointmentsForDayReminder(config, allAppointments);
  const hourEligible = filterAppointmentsForHourReminder(config, allAppointments);

  const dailyLimit = evaluateDailyLimit(config, dailyUsage);
  const monthlyLimit = evaluateMessageLimit(config, monthlyUsage);
  const nextAppointments = allAppointments
    .filter((appointment) => !appointment.dayReminderSentAt || !appointment.hourReminderSentAt)
    .slice(0, 10)
    .map(summarizeAppointment);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    remindersEnabled: config.remindersEnabled,
    dryRun: config.remindersDryRun,
    limits: {
      daily: dailyLimit,
      monthly: monthlyLimit,
      perRun: {
        enabled: config.maxMessagesPerRun > 0,
        limit: config.maxMessagesPerRun,
      },
    },
    today: {
      messageLog: todayStats,
      eligibleNow: {
        counts: {
          day: dayEligible.length,
          hour: hourEligible.length,
        },
        day: dayEligible.map(summarizeAppointment),
        hour: hourEligible.map(summarizeAppointment),
      },
    },
    upcoming: {
      totalMatched: allAppointments.length,
      nextPending: nextAppointments,
      operational: appointmentOps,
    },
    inbound: {
      today: inboundStats,
      recent: recentInbound.map(sanitizeInboundAuditRow),
    },
    recentLogs: recentLogs.map(sanitizeLogRow),
  };
}
