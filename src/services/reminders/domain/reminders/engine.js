import {
  filterAppointmentsForDayReminder,
  filterAppointmentsForHourReminder,
  listReminderAppointments,
  markReminderSent,
} from "./appointments.js";
import {
  evaluateDailyLimit,
  evaluateMessageLimit,
  getDailyUsage,
  getMonthlyUsage,
  incrementDailyUsage,
  incrementMonthlyUsage,
  markMonthlyWarningSent,
} from "../../persistence/usage-limits.js";
import { logReminderEvent } from "../../persistence/message-log.js";
import {
  sendOneHourReminder,
  sendSameDayReminder,
} from "../../integrations/whatsapp/client.js";

function createSkippedEntry(id, type, reason) {
  return { id, type, reason };
}

async function logSkippedReminder(config, appointment, reminderType, skipReason) {
  await logReminderEvent(config, {
    appointmentId: appointment.id,
    reminderType,
    templateName:
      reminderType === "day"
        ? config.whatsappTemplateSameDay
        : config.whatsappTemplateOneHour,
    patientName: appointment.patientName,
    patientEmail: appointment.patientEmail,
    patientPhone: appointment.patientPhone,
    startsAt: appointment.startsAt,
    status: "skipped",
    skipReason,
  });
}

function buildDisabledSummary(config, sameDayAppointments, oneHourAppointments) {
  return {
    ok: true,
    checked: {
      day: sameDayAppointments.length,
      hour: oneHourAppointments.length,
    },
    monthlyLimit: {
      enabled: config.monthlyMessageLimit > 0,
      limit: config.monthlyMessageLimit,
      sentCount: 0,
      warningThreshold: config.monthlyMessageWarningThreshold,
      warningReached: false,
      warningAlreadySent: false,
      limitReached: false,
    },
    dailyLimit: {
      enabled: config.maxMessagesPerDay > 0,
      limit: config.maxMessagesPerDay,
      sentCount: 0,
      limitReached: false,
    },
    runLimit: {
      enabled: config.maxMessagesPerRun > 0,
      limit: config.maxMessagesPerRun,
      sentCount: 0,
      limitReached: false,
    },
    sent: [],
    failed: [],
    skipped: [
      ...sameDayAppointments.map((appointment) =>
        createSkippedEntry(appointment.id, "day", "reminders_disabled")
      ),
      ...oneHourAppointments.map((appointment) =>
        createSkippedEntry(appointment.id, "hour", "reminders_disabled")
      ),
    ],
  };
}

async function logDisabledAppointments(config, sameDayAppointments, oneHourAppointments) {
  for (const appointment of sameDayAppointments) {
    await logSkippedReminder(config, appointment, "day", "reminders_disabled");
  }

  for (const appointment of oneHourAppointments) {
    await logSkippedReminder(config, appointment, "hour", "reminders_disabled");
  }
}

function findAppointmentByType(type, appointmentId, sameDayAppointments, oneHourAppointments) {
  return type === "day"
    ? sameDayAppointments.find((item) => item.id === appointmentId)
    : oneHourAppointments.find((item) => item.id === appointmentId);
}

export async function runReminderEngine(config, mockedAppointments = null) {
  let sameDayAppointments, oneHourAppointments;

  if (mockedAppointments) {
    console.log("🧪 MODO TEST: Usando citas simuladas");
    sameDayAppointments = mockedAppointments.day || [];
    oneHourAppointments = mockedAppointments.hour || [];
  } else {
    const appointments = await listReminderAppointments(config);
    sameDayAppointments = filterAppointmentsForDayReminder(config, appointments);
    oneHourAppointments = filterAppointmentsForHourReminder(config, appointments);
  }

  if (!config.remindersEnabled) {
    await logDisabledAppointments(config, sameDayAppointments, oneHourAppointments);
    return buildDisabledSummary(config, sameDayAppointments, oneHourAppointments);
  }

  let dailyUsage = await getDailyUsage(config);
  let dailyLimitState = evaluateDailyLimit(config, dailyUsage);
  let usage = await getMonthlyUsage(config);
  let limitState = evaluateMessageLimit(config, usage);

  const sent = [];
  const failed = [];
  const skipped = [];
  let warningTriggered = false;
  let runSentCount = 0;

  async function shouldSkipAppointment(type, appointmentId) {
    const appointment = findAppointmentByType(
      type,
      appointmentId,
      sameDayAppointments,
      oneHourAppointments
    );

    if (config.maxMessagesPerRun > 0 && runSentCount >= config.maxMessagesPerRun) {
      skipped.push(createSkippedEntry(appointmentId, type, "max_messages_per_run_reached"));
      if (appointment) {
        await logSkippedReminder(config, appointment, type, "max_messages_per_run_reached");
      }
      return true;
    }

    if (dailyLimitState.limitReached) {
      skipped.push(createSkippedEntry(appointmentId, type, "daily_limit_reached"));
      if (appointment) {
        await logSkippedReminder(config, appointment, type, "daily_limit_reached");
      }
      return true;
    }

    if (limitState.limitReached) {
      skipped.push(createSkippedEntry(appointmentId, type, "monthly_limit_reached"));
      if (appointment) {
        await logSkippedReminder(config, appointment, type, "monthly_limit_reached");
      }
      return true;
    }

    return false;
  }

  for (const appointment of sameDayAppointments) {
    if (await shouldSkipAppointment("day", appointment.id)) {
      continue;
    }

    try {
      const providerResponse = await sendSameDayReminder(config, appointment);
      await markReminderSent(config, appointment.id, "day");
      dailyUsage = await incrementDailyUsage(config, 1);
      dailyLimitState = evaluateDailyLimit(config, dailyUsage);
      usage = await incrementMonthlyUsage(config, 1);
      limitState = evaluateMessageLimit(config, usage);
      runSentCount += 1;

      await logReminderEvent(config, {
        appointmentId: appointment.id,
        reminderType: "day",
        templateName: config.whatsappTemplateSameDay,
        patientName: appointment.patientName,
        patientEmail: appointment.patientEmail,
        patientPhone: appointment.patientPhone,
        startsAt: appointment.startsAt,
        status: "sent",
        providerMessageId: providerResponse?.messages?.[0]?.id || null,
        metaResponse: providerResponse,
      });

      if (
        limitState.enabled &&
        !limitState.warningAlreadySent &&
        limitState.warningReached &&
        !warningTriggered
      ) {
        await markMonthlyWarningSent(config);
        warningTriggered = true;
        limitState.warningAlreadySent = true;
      }

      sent.push({ id: appointment.id, type: "day" });
    } catch (error) {
      await logReminderEvent(config, {
        appointmentId: appointment.id,
        reminderType: "day",
        templateName: config.whatsappTemplateSameDay,
        patientName: appointment.patientName,
        patientEmail: appointment.patientEmail,
        patientPhone: appointment.patientPhone,
        startsAt: appointment.startsAt,
        status: "failed",
        errorMessage: error.message,
      });

      failed.push({
        id: appointment.id,
        type: "day",
        error: error.message,
      });
    }
  }

  for (const appointment of oneHourAppointments) {
    if (await shouldSkipAppointment("hour", appointment.id)) {
      continue;
    }

    try {
      const providerResponse = await sendOneHourReminder(config, appointment);
      await markReminderSent(config, appointment.id, "hour");
      dailyUsage = await incrementDailyUsage(config, 1);
      dailyLimitState = evaluateDailyLimit(config, dailyUsage);
      usage = await incrementMonthlyUsage(config, 1);
      limitState = evaluateMessageLimit(config, usage);
      runSentCount += 1;

      await logReminderEvent(config, {
        appointmentId: appointment.id,
        reminderType: "hour",
        templateName: config.whatsappTemplateOneHour,
        patientName: appointment.patientName,
        patientEmail: appointment.patientEmail,
        patientPhone: appointment.patientPhone,
        startsAt: appointment.startsAt,
        status: "sent",
        providerMessageId: providerResponse?.messages?.[0]?.id || null,
        metaResponse: providerResponse,
      });

      if (
        limitState.enabled &&
        !limitState.warningAlreadySent &&
        limitState.warningReached &&
        !warningTriggered
      ) {
        await markMonthlyWarningSent(config);
        warningTriggered = true;
        limitState.warningAlreadySent = true;
      }

      sent.push({ id: appointment.id, type: "hour" });
    } catch (error) {
      await logReminderEvent(config, {
        appointmentId: appointment.id,
        reminderType: "hour",
        templateName: config.whatsappTemplateOneHour,
        patientName: appointment.patientName,
        patientEmail: appointment.patientEmail,
        patientPhone: appointment.patientPhone,
        startsAt: appointment.startsAt,
        status: "failed",
        errorMessage: error.message,
      });

      failed.push({
        id: appointment.id,
        type: "hour",
        error: error.message,
      });
    }
  }

  return {
    ok: true,
    checked: {
      day: sameDayAppointments.length,
      hour: oneHourAppointments.length,
    },
    dailyLimit: {
      enabled: dailyLimitState.enabled,
      limit: dailyLimitState.limit,
      sentCount: dailyLimitState.sentCount,
      limitReached: dailyLimitState.limitReached,
    },
    monthlyLimit: {
      enabled: limitState.enabled,
      limit: limitState.limit,
      sentCount: limitState.sentCount,
      warningThreshold: limitState.warningThreshold,
      warningReached: limitState.warningReached,
      warningAlreadySent: limitState.warningAlreadySent,
      limitReached: limitState.limitReached,
    },
    runLimit: {
      enabled: config.maxMessagesPerRun > 0,
      limit: config.maxMessagesPerRun,
      sentCount: runSentCount,
      limitReached: config.maxMessagesPerRun > 0 && runSentCount >= config.maxMessagesPerRun,
    },
    sent,
    failed,
    skipped,
  };
}
