import { getPostgresPool } from "../integrations/postgres/client.js";

function createDedupKey(row) {
  const startsAt = new Date(row.starts_at).toISOString();
  const identity = String(row.patient_email || row.patient_phone || row.appointment_id)
    .trim()
    .toLowerCase();

  return `${identity}|${startsAt}`;
}

function pickPreferredAppointment(current, next) {
  if (!current) return next;

  if (current.source === "calendly" && next.source !== "calendly") return current;
  if (next.source === "calendly" && current.source !== "calendly") return next;

  return new Date(next.updated_at || next.synced_at || next.starts_at) >
    new Date(current.updated_at || current.synced_at || current.starts_at)
    ? next
    : current;
}

function dedupeAppointmentRows(rows) {
  const deduped = new Map();

  for (const row of rows) {
    const key = createDedupKey(row);
    deduped.set(key, pickPreferredAppointment(deduped.get(key), row));
  }

  return [...deduped.values()].sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at));
}

function getSourceFilter(config) {
  if (config.appointmentSource === "google") {
    return ["google_calendar"];
  }

  if (config.appointmentSource === "calendly" || config.appointmentSource === "calendly_api") {
    return ["calendly"];
  }

  return null;
}

export async function ensureAppointmentsTable(config) {
  const pool = getPostgresPool(config);

  await pool.query(`
    create table if not exists whatsapp_appointments (
      appointment_id text primary key,
      source text not null default 'google_calendar',
      source_event_id text not null,
      starts_at timestamptz not null,
      timezone text,
      calendar_status text,
      patient_name text,
      patient_email text,
      patient_phone text,
      eligibility_status text not null,
      skip_reason text,
      error_message text,
      raw_event jsonb,
      synced_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists whatsapp_appointments_starts_at_idx
      on whatsapp_appointments (starts_at);

    create index if not exists whatsapp_appointments_eligibility_idx
      on whatsapp_appointments (eligibility_status, starts_at);

    create index if not exists whatsapp_appointments_patient_email_idx
      on whatsapp_appointments (patient_email);

    create index if not exists whatsapp_appointments_patient_phone_idx
      on whatsapp_appointments (patient_phone);
  `);
}

export async function ensureReminderStateTable(config) {
  const pool = getPostgresPool(config);

  await pool.query(`
    create table if not exists whatsapp_reminder_state (
      appointment_id text primary key,
      day_sent_at timestamptz,
      hour_sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
}

export async function upsertAppointments(config, appointments) {
  if (!appointments.length) {
    return 0;
  }

  await ensureAppointmentsTable(config);
  const pool = getPostgresPool(config);

  for (const appointment of appointments) {
    await pool.query(
      `
        insert into whatsapp_appointments (
          appointment_id,
          source,
          source_event_id,
          starts_at,
          timezone,
          calendar_status,
          patient_name,
          patient_email,
          patient_phone,
          eligibility_status,
          skip_reason,
          error_message,
          raw_event,
          synced_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13::jsonb, now(), now()
        )
        on conflict (appointment_id)
        do update set
          source = excluded.source,
          source_event_id = excluded.source_event_id,
          starts_at = excluded.starts_at,
          timezone = excluded.timezone,
          calendar_status = excluded.calendar_status,
          patient_name = excluded.patient_name,
          patient_email = excluded.patient_email,
          patient_phone = excluded.patient_phone,
          eligibility_status = excluded.eligibility_status,
          skip_reason = excluded.skip_reason,
          error_message = excluded.error_message,
          raw_event = excluded.raw_event,
          synced_at = now(),
          updated_at = now()
      `,
      [
        appointment.id,
        appointment.source,
        appointment.sourceEventId,
        appointment.startsAt,
        appointment.timezone,
        appointment.calendarStatus,
        appointment.patientName,
        appointment.patientEmail,
        appointment.patientPhone,
        appointment.eligibilityStatus,
        appointment.skipReason,
        appointment.errorMessage,
        JSON.stringify(appointment.rawEvent || null),
      ]
    );
  }

  return appointments.length;
}

export async function cancelAppointment(config, appointmentId, rawEvent = null) {
  await ensureAppointmentsTable(config);
  const pool = getPostgresPool(config);

  const { rowCount } = await pool.query(
    `
      update whatsapp_appointments
      set
        calendar_status = 'cancelled',
        eligibility_status = 'cancelled',
        skip_reason = 'appointment_cancelled',
        error_message = null,
        raw_event = coalesce($2::jsonb, raw_event),
        synced_at = now(),
        updated_at = now()
      where appointment_id = $1
    `,
    [appointmentId, rawEvent ? JSON.stringify(rawEvent) : null]
  );

  return rowCount;
}

export async function fetchEligibleReminderAppointments(config) {
  await ensureAppointmentsTable(config);
  await ensureReminderStateTable(config);

  const pool = getPostgresPool(config);
  const sourceFilter = getSourceFilter(config);
  const { rows } = await pool.query(
    `
      select
        a.appointment_id,
        a.source,
        a.patient_name,
        a.patient_email,
        a.patient_phone,
        a.starts_at,
        a.timezone,
        a.calendar_status,
        a.synced_at,
        a.updated_at,
        s.day_sent_at,
        s.hour_sent_at
      from whatsapp_appointments a
      left join whatsapp_reminder_state s
        on s.appointment_id = a.appointment_id
      where a.eligibility_status = 'eligible'
        and coalesce(a.calendar_status, 'scheduled') <> 'cancelled'
        and a.starts_at >= now()
        and ($1::text[] is null or a.source = any($1::text[]))
      order by a.starts_at asc
    `,
    [sourceFilter]
  );

  return dedupeAppointmentRows(rows).map((row) => ({
    id: row.appointment_id,
    source: row.source,
    patientName: row.patient_name,
    patientEmail: row.patient_email,
    patientPhone: row.patient_phone,
    startsAt: row.starts_at,
    timezone: row.timezone || config.timezone,
    status: row.calendar_status,
    dayReminderSentAt: row.day_sent_at || null,
    hourReminderSentAt: row.hour_sent_at || null,
  }));
}

export async function fetchAppointmentOperationalSummary(config) {
  await ensureAppointmentsTable(config);

  const pool = getPostgresPool(config);
  const sourceFilter = getSourceFilter(config);
  const { rows: statusRows } = await pool.query(
    `
      select
        eligibility_status,
        skip_reason,
        count(*)::integer as count
      from whatsapp_appointments
      where starts_at >= now()
        and ($1::text[] is null or source = any($1::text[]))
      group by eligibility_status, skip_reason
      order by eligibility_status, skip_reason
    `,
    [sourceFilter]
  );

  const { rows: upcomingRows } = await pool.query(
    `
      select
        appointment_id,
        source_event_id,
        starts_at,
        timezone,
        calendar_status,
        patient_name,
        patient_email,
        patient_phone,
        eligibility_status,
        skip_reason,
        error_message,
        synced_at
      from whatsapp_appointments
      where starts_at >= now()
        and ($1::text[] is null or source = any($1::text[]))
      order by starts_at asc
      limit 20
    `,
    [sourceFilter]
  );

  const { rows: issueRows } = await pool.query(
    `
      select
        appointment_id,
        source_event_id,
        starts_at,
        patient_name,
        patient_email,
        patient_phone,
        eligibility_status,
        skip_reason,
        error_message,
        synced_at
      from whatsapp_appointments
      where starts_at >= now()
        and eligibility_status <> 'eligible'
        and ($1::text[] is null or source = any($1::text[]))
      order by starts_at asc
      limit 20
    `,
    [sourceFilter]
  );

  const totals = {
    eligible: 0,
    unmatched: 0,
    invalidContact: 0,
    other: 0,
  };
  const skipReasons = {};

  for (const row of statusRows) {
    if (row.eligibility_status === "eligible") {
      totals.eligible += row.count;
    } else if (row.eligibility_status === "unmatched") {
      totals.unmatched += row.count;
    } else if (row.eligibility_status === "invalid_contact") {
      totals.invalidContact += row.count;
    } else {
      totals.other += row.count;
    }

    if (row.skip_reason) {
      skipReasons[row.skip_reason] = (skipReasons[row.skip_reason] || 0) + row.count;
    }
  }

  const sanitize = (row) => ({
    appointmentId: row.appointment_id,
    sourceEventId: row.source_event_id,
    startsAt: row.starts_at,
    timezone: row.timezone,
    calendarStatus: row.calendar_status,
    patientName: row.patient_name,
    patientEmail: row.patient_email,
    patientPhone: row.patient_phone,
    eligibilityStatus: row.eligibility_status,
    skipReason: row.skip_reason,
    errorMessage: row.error_message,
    syncedAt: row.synced_at,
  });

  return {
    totals,
    skipReasons,
    upcoming: upcomingRows.map(sanitize),
    issues: issueRows.map(sanitize),
  };
}
