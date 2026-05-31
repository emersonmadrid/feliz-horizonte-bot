import dotenv from "dotenv";

dotenv.config();

function cleanEnvValue(value) {
  if (value === undefined || value === null) {
    return value;
  }

  const normalized = String(value).trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }

  if (normalized === "") {
    return undefined;
  }

  return normalized;
}

function isValidTimezone(value) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function required(name) {
  const value = cleanEnvValue(process.env[name]);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name) {
  return cleanEnvValue(process.env[name]) || null;
}

function validateAppointmentSource(value) {
  if (["google", "calendly", "calendly_api", "hybrid"].includes(value)) {
    return value;
  }

  throw new Error(`Invalid APPOINTMENT_SOURCE: ${value}`);
}

function usesGoogleSource(source) {
  return source === "google" || source === "hybrid";
}

function numberInRange(name, fallback, { min, max }) {
  const rawValue = cleanEnvValue(process.env[name]);
  const value = rawValue === undefined ? fallback : Number(rawValue);

  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid env var ${name}: expected number between ${min} and ${max}`);
  }

  return value;
}

function booleanEnv(name, fallback) {
  const rawValue = cleanEnvValue(process.env[name]);

  if (rawValue === undefined) {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid env var ${name}: expected boolean`);
}

function getTimezone() {
  const timezone = cleanEnvValue(process.env.APP_TIMEZONE) || "America/Lima";

  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid env var APP_TIMEZONE: ${timezone}`);
  }

  return timezone;
}

export function loadConfig() {
  const databaseUrl = cleanEnvValue(process.env.DATABASE_URL) || null;
  const appointmentSource = validateAppointmentSource(
    cleanEnvValue(process.env.APPOINTMENT_SOURCE) || "google"
  );
  const monthlyMessageLimit = numberInRange("MONTHLY_MESSAGE_LIMIT", 0, { min: 0, max: 1000000 });
  const monthlyMessageWarningThreshold = numberInRange(
    "MONTHLY_MESSAGE_WARNING_THRESHOLD",
    0,
    { min: 0, max: 1000000 }
  );
  const remindersEnabled = booleanEnv("REMINDERS_ENABLED", true);
  const remindersDryRun = booleanEnv("REMINDERS_DRY_RUN", false);
  const maxMessagesPerRun = numberInRange("MAX_MESSAGES_PER_RUN", 0, { min: 0, max: 1000000 });
  const maxMessagesPerDay = numberInRange("MAX_MESSAGES_PER_DAY", 0, { min: 0, max: 1000000 });

  return {
    cronSecret: required("CRON_SECRET"),
    appointmentSource,
    timezone: getTimezone(),
    dayReminderHour: numberInRange("DAY_REMINDER_HOUR", 8, { min: 0, max: 23 }),
    hourReminderLeadMinutes: numberInRange("HOUR_REMINDER_LEAD_MINUTES", 60, { min: 1, max: 1440 }),
    hourReminderWindowMinutes: numberInRange("HOUR_REMINDER_WINDOW_MINUTES", 5, { min: 1, max: 180 }),
    remindersEnabled,
    remindersDryRun,
    maxMessagesPerRun,
    maxMessagesPerDay,
    monthlyMessageLimit,
    monthlyMessageWarningThreshold,
    googleCalendarId:
      usesGoogleSource(appointmentSource) ? required("GOOGLE_CALENDAR_ID") : optional("GOOGLE_CALENDAR_ID"),
    googleCalendarClientEmail:
      usesGoogleSource(appointmentSource)
        ? required("GOOGLE_CALENDAR_CLIENT_EMAIL")
        : optional("GOOGLE_CALENDAR_CLIENT_EMAIL"),
    googleCalendarPrivateKey:
      usesGoogleSource(appointmentSource)
        ? required("GOOGLE_CALENDAR_PRIVATE_KEY")
        : optional("GOOGLE_CALENDAR_PRIVATE_KEY"),
    googleCalendarTimezone: cleanEnvValue(process.env.CALENDAR_TIMEZONE) || getTimezone(),
    googleCalendarLookaheadDays: numberInRange("GOOGLE_CALENDAR_LOOKAHEAD_DAYS", 7, { min: 1, max: 30 }),
    googleSheetsSpreadsheetId:
      usesGoogleSource(appointmentSource) || appointmentSource === "calendly_api" || appointmentSource === "calendly"
        ? required("GOOGLE_SHEETS_SPREADSHEET_ID")
        : optional("GOOGLE_SHEETS_SPREADSHEET_ID"),
    googleSheetsSheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || "Pacientes",
    googleSheetsEmailColumn: process.env.GOOGLE_SHEETS_EMAIL_COLUMN || "Email",
    googleSheetsPhoneColumn: process.env.GOOGLE_SHEETS_PHONE_COLUMN || "Telefono",
    googleSheetsFirstNameColumn: process.env.GOOGLE_SHEETS_FIRST_NAME_COLUMN || "Nombre",
    googleSheetsLastNameColumn: process.env.GOOGLE_SHEETS_LAST_NAME_COLUMN || "Apellidos",
    databaseUrl,
    directUrl: cleanEnvValue(process.env.DIRECT_URL) || null,
    whatsappApiToken: required("WHATSAPP_API_TOKEN"),
    whatsappPhoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    whatsappTemplateSameDay: required("WHATSAPP_TEMPLATE_SAME_DAY"),
    whatsappTemplateOneHour: required("WHATSAPP_TEMPLATE_ONE_HOUR"),
    whatsappLanguageCode: cleanEnvValue(process.env.WHATSAPP_LANGUAGE_CODE) || "es_PE",
    calendlyApiToken:
      appointmentSource === "calendly_api" ? required("CALENDLY_API_TOKEN") : optional("CALENDLY_API_TOKEN"),
    calendlyUserUri: optional("CALENDLY_USER_URI"),
    calendlyOrganizationUri: optional("CALENDLY_ORGANIZATION_URI"),
    calendlyWebhookSecret: optional("CALENDLY_WEBHOOK_SECRET"),
    calendlyTimezone: cleanEnvValue(process.env.CALENDLY_TIMEZONE) || getTimezone(),
    calendlyLookaheadDays: numberInRange("CALENDLY_LOOKAHEAD_DAYS", 7, { min: 1, max: 30 }),
  };
}

export function getPublicConfig() {
  const appointmentSource = validateAppointmentSource(
    cleanEnvValue(process.env.APPOINTMENT_SOURCE) || "google"
  );

  return {
    appointmentSource,
    timezone: getTimezone(),
    dayReminderHour: numberInRange("DAY_REMINDER_HOUR", 8, { min: 0, max: 23 }),
    hourReminderLeadMinutes: numberInRange("HOUR_REMINDER_LEAD_MINUTES", 60, { min: 1, max: 1440 }),
    hourReminderWindowMinutes: numberInRange("HOUR_REMINDER_WINDOW_MINUTES", 5, { min: 1, max: 180 }),
    remindersEnabled: booleanEnv("REMINDERS_ENABLED", true),
    remindersDryRun: booleanEnv("REMINDERS_DRY_RUN", false),
    maxMessagesPerRun: numberInRange("MAX_MESSAGES_PER_RUN", 0, { min: 0, max: 1000000 }),
    maxMessagesPerDay: numberInRange("MAX_MESSAGES_PER_DAY", 0, { min: 0, max: 1000000 }),
    monthlyMessageLimit: numberInRange("MONTHLY_MESSAGE_LIMIT", 0, { min: 0, max: 1000000 }),
    monthlyMessageWarningThreshold: numberInRange("MONTHLY_MESSAGE_WARNING_THRESHOLD", 0, {
      min: 0,
      max: 1000000,
    }),
    databaseMode: cleanEnvValue(process.env.DATABASE_URL) ? "postgres" : "supabase",
    googleCalendarLookaheadDays: numberInRange("GOOGLE_CALENDAR_LOOKAHEAD_DAYS", 7, { min: 1, max: 30 }),
    whatsappLanguageCode: cleanEnvValue(process.env.WHATSAPP_LANGUAGE_CODE) || "es_PE",
  };
}

export function validateCronSecret(req) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const cronHeader = req.headers["x-cron-secret"];

  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}
