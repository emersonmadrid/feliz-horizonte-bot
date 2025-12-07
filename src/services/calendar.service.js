import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import {
  addDays,
  addMinutes,
  isBefore,
  max as maxDate, // Renombramos 'max' a 'maxDate' para evitar confusiones
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const TIMEZONE = process.env.CALENDAR_TIMEZONE || "America/Lima";

const WORK_START_HOUR = 14; // 2:00 PM
const WORK_END_HOUR = 21; // 9:00 PM (exclusive)
const SLOT_MINUTES = 60;

function ensureCalendarConfig() {
  if (!CALENDAR_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    throw new Error("Faltan credenciales de Google Calendar en el .env");
  }
}

function getCalendarClient() {
  ensureCalendarConfig();

  const auth = new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });

  return google.calendar({ version: "v3", auth });
}

function buildDayWindow(baseDate, includeTodayOffset = false) {
  const dayStart = setMinutes(setHours(startOfDay(baseDate), WORK_START_HOUR), 0);
  const dayEnd = setMinutes(setHours(startOfDay(baseDate), WORK_END_HOUR), 0);

  // CORRECCIÓN AQUÍ: maxDate requiere un ARRAY de fechas en date-fns v2/v3
  const zonedStart = includeTodayOffset
    ? maxDate([dayStart, baseDate]) // <--- ¡AQUÍ ESTABA EL ERROR! (Faltaban los corchetes [])
    : dayStart;

  return {
    start: zonedStart,
    end: dayEnd,
  };
}

function getFreeSlots(busyIntervals, windowStart, windowEnd) {
  const slots = [];
  const busy = [...busyIntervals].sort((a, b) => a.start - b.start);

  for (
    let slotStart = windowStart;
    isBefore(slotStart, windowEnd);
    slotStart = addMinutes(slotStart, SLOT_MINUTES)
  ) {
    const slotEnd = addMinutes(slotStart, SLOT_MINUTES);
    
    // Verificar que el slot esté dentro de la ventana y sea futuro
    if (!isBefore(slotEnd, windowStart) && !isBefore(windowEnd, slotEnd)) {
      const overlaps = busy.some((interval) =>
        !(isBefore(slotEnd, interval.start) || isBefore(interval.end, slotStart))
      );

      if (!overlaps) {
        slots.push(slotStart);
      }
    }
  }

  return slots;
}

function groupConsecutiveSlots(slots) {
  if (!slots.length) return [];

  const ranges = [];
  let rangeStart = slots[0];
  let rangeEnd = addMinutes(rangeStart, SLOT_MINUTES);

  for (let i = 1; i < slots.length; i++) {
    const current = slots[i];
    if (+current === +rangeEnd) {
      rangeEnd = addMinutes(rangeEnd, SLOT_MINUTES);
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = current;
      rangeEnd = addMinutes(current, SLOT_MINUTES);
    }
  }

  ranges.push({ start: rangeStart, end: rangeEnd });
  return ranges;
}

function formatDayAvailability(dateLabel, ranges) {
  if (!ranges.length) return null;

  const rangeText = ranges
    .map(({ start, end }) => `${formatInTimeZone(start, "h:mm a", TIMEZONE)} - ${formatInTimeZone(end, "h:mm a", TIMEZONE)}`)
    .join(" | ");

  return `🗓️ *${dateLabel}:* ${rangeText}`;
}

export async function getNextAvailability(days = 3) {
  const calendar = getCalendarClient();
  const now = new Date();
  const zonedNow = toZonedTime(now, TIMEZONE); // Usando toZonedTime (v3)

  const availabilityLines = [];

  for (let i = 0; i < days; i++) {
    const dayBase = addDays(zonedNow, i);
    const includeTodayOffset = i === 0;
    
    // Obtener ventana de trabajo
    const { start, end } = buildDayWindow(dayBase, includeTodayOffset);

    // Si la hora de inicio es después de la hora de fin (ej: ya pasó el turno de hoy), saltar
    if (!isBefore(start, end)) continue;

    const timeMin = fromZonedTime(start, TIMEZONE).toISOString(); // Usando fromZonedTime (v3)
    const timeMax = fromZonedTime(end, TIMEZONE).toISOString();

    try {
        const { data } = await calendar.freebusy.query({
        requestBody: {
            timeMin,
            timeMax,
            items: [{ id: CALENDAR_ID }],
            timeZone: TIMEZONE,
        },
        });

        const busyEntries = data?.calendars?.[CALENDAR_ID]?.busy || [];
        const busyIntervals = busyEntries.map(({ start: startIso, end: endIso }) => ({
        start: toZonedTime(parseISO(startIso), TIMEZONE),
        end: toZonedTime(parseISO(endIso), TIMEZONE),
        }));

        const freeSlots = getFreeSlots(busyIntervals, start, end);
        const ranges = groupConsecutiveSlots(freeSlots);

        const dateLabel = formatInTimeZone(dayBase, "EEEE dd/MM", TIMEZONE);
        const formattedLine = formatDayAvailability(dateLabel, ranges);

        if (formattedLine) {
        availabilityLines.push(formattedLine);
        }
    } catch (e) {
        console.error(`Error consultando día ${i}:`, e.message);
    }
  }

  if (!availabilityLines.length) return "";

  return [
    "📅 *Estos son los próximos horarios disponibles:*",
    ...availabilityLines,
    `\n⏰ Horario en zona local (${TIMEZONE}).`
  ].join("\n");
}

const calendarService = { getNextAvailability };
export default calendarService;