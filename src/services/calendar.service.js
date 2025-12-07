import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import {
  addDays,
  addMinutes,
  isBefore,
  max as maxDate,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
  isValid,
  getDay
} from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const TIMEZONE = process.env.CALENDAR_TIMEZONE?.trim() || "America/Lima";

// 🔧 HORARIOS ESPECÍFICOS POR DÍA
const SCHEDULE_BY_DAY = {
  0: { start: 10, end: 15, label: "Domingo" },     // 10:00 AM - 3:00 PM
  1: { start: 9, end: 21, label: "Lunes" },        // 9:00 AM - 9:00 PM
  2: { start: 9, end: 21, label: "Martes" },
  3: { start: 9, end: 21, label: "Miércoles" },
  4: { start: 9, end: 21, label: "Jueves" },
  5: { start: 9, end: 21, label: "Viernes" },
  6: { start: 9, end: 21, label: "Sábado" }
};

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
  if (!isValid(baseDate)) {
    throw new Error(`Fecha base inválida en buildDayWindow: ${baseDate}`);
  }

  const dayOfWeek = getDay(baseDate);
  const schedule = SCHEDULE_BY_DAY[dayOfWeek] || { start: 9, end: 21 };

  const dayStart = setMinutes(setHours(startOfDay(baseDate), schedule.start), 0);
  const dayEnd = setMinutes(setHours(startOfDay(baseDate), schedule.end), 0);

  const zonedStart = includeTodayOffset
    ? maxDate([dayStart, baseDate]) 
    : dayStart;

  return {
    start: zonedStart,
    end: dayEnd,
  };
}

function getFreeSlots(busyIntervals, windowStart, windowEnd) {
  const slots = [];
  const busy = busyIntervals
    .filter(i => isValid(i.start) && isValid(i.end))
    .sort((a, b) => a.start - b.start);

  for (
    let slotStart = windowStart;
    isBefore(slotStart, windowEnd);
    slotStart = addMinutes(slotStart, SLOT_MINUTES)
  ) {
    const slotEnd = addMinutes(slotStart, SLOT_MINUTES);
    
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
    .map(({ start, end }) => {
      try {
        const startStr = formatInTimeZone(start, TIMEZONE, "h:mm a");
        const endStr = formatInTimeZone(end, TIMEZONE, "h:mm a");
        return `${startStr} - ${endStr}`;
      } catch (err) {
        console.error("⚠️ Error formateando rango:", err.message);
        return null;
      }
    })
    .filter(Boolean)
    .join(" | ");

  return rangeText ? `🗓️ *${dateLabel}:* ${rangeText}` : null;
}

// 📅 FALLBACK: Horarios genéricos cuando no hay disponibilidad real
function getGenericSchedule() {
  return `📅 *Horarios de atención generales:*

🗓️ *Lunes a Viernes:* 9:00 AM - 9:00 PM
🗓️ *Sábados:* 9:00 AM - 9:00 PM  
🗓️ *Domingos:* 10:00 AM - 3:00 PM

⚠️ *Nota:* Estos son nuestros horarios habituales, pero la disponibilidad específica puede variar. Un miembro de nuestro equipo te confirmará el horario exacto disponible.`;
}

export async function getNextAvailability(days = 3) {
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    
    if (!isValid(now)) {
      console.error("❌ Fecha actual inválida");
      return getGenericSchedule();
    }

    let zonedNow;
    try {
      zonedNow = toZonedTime(now, TIMEZONE);
      if (!isValid(zonedNow)) {
        throw new Error("Conversión a zona horaria falló");
      }
    } catch (err) {
      console.error(`❌ Error crítico de zona horaria (${TIMEZONE}):`, err.message);
      return getGenericSchedule();
    }

    const availabilityLines = [];

    for (let i = 0; i < days; i++) {
      try {
        const dayBase = addDays(zonedNow, i);
        
        if (!isValid(dayBase)) {
          console.error(`⚠️ Día ${i} inválido después de addDays`);
          continue;
        }

        const includeTodayOffset = i === 0;
        const { start, end } = buildDayWindow(dayBase, includeTodayOffset);

        if (!isBefore(start, end)) continue;

        const timeMin = fromZonedTime(start, TIMEZONE).toISOString();
        const timeMax = fromZonedTime(end, TIMEZONE).toISOString();

        const { data } = await calendar.freebusy.query({
          requestBody: {
            timeMin,
            timeMax,
            items: [{ id: CALENDAR_ID }],
            timeZone: TIMEZONE,
          },
        });

        const busyEntries = data?.calendars?.[CALENDAR_ID]?.busy || [];
        const busyIntervals = busyEntries.map(({ start: startIso, end: endIso }) => {
          try {
            return {
              start: toZonedTime(parseISO(startIso), TIMEZONE),
              end: toZonedTime(parseISO(endIso), TIMEZONE),
            };
          } catch (err) {
            console.error("⚠️ Error parseando intervalo ocupado:", err.message);
            return null;
          }
        }).filter(Boolean);

        const freeSlots = getFreeSlots(busyIntervals, start, end);
        const ranges = groupConsecutiveSlots(freeSlots);

        const dateLabel = formatInTimeZone(dayBase, TIMEZONE, "EEEE dd/MM");
        const formattedLine = formatDayAvailability(dateLabel, ranges);

        if (formattedLine) {
          availabilityLines.push(formattedLine);
        }
      } catch (e) {
        console.error(`⚠️ Error procesando día ${i}:`, e.message);
      }
    }

    // ✅ Si encontramos disponibilidad real, la mostramos
    if (availabilityLines.length > 0) {
      return [
        "📅 *Estos son los próximos horarios disponibles:*",
        ...availabilityLines,
        `\n⏰ Horario en zona local (${TIMEZONE}).`
      ].join("\n");
    }

    // ❌ Si NO hay disponibilidad, mostramos horarios genéricos
    console.log("⚠️ No se encontraron horarios específicos, usando fallback genérico");
    return getGenericSchedule();

  } catch (globalErr) {
    console.error("❌ Error general en Calendar:", globalErr.message);
    // Fallback ante cualquier error
    return getGenericSchedule();
  }
}

const calendarService = { getNextAvailability };
export default calendarService;