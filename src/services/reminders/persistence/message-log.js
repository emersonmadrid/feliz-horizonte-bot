import { getPostgresPool } from "../integrations/postgres/client.js";

export async function ensureMessageLogTable(config) {
  const pool = getPostgresPool(config);

  const queries = [
    `create table if not exists whatsapp_message_log (
      id bigserial primary key,
      appointment_id text not null,
      reminder_type text not null,
      template_name text,
      patient_name text,
      patient_email text,
      patient_phone text,
      starts_at timestamptz,
      status text not null,
      skip_reason text,
      error_message text,
      provider_message_id text,
      meta_response jsonb,
      created_at timestamptz not null default now()
    )`,
    `create index if not exists whatsapp_message_log_created_at_idx on whatsapp_message_log (created_at desc)`,
    `create index if not exists whatsapp_message_log_appointment_id_idx on whatsapp_message_log (appointment_id, created_at desc)`,
    `create unique index if not exists whatsapp_message_log_terminal_status_idx on whatsapp_message_log (appointment_id, reminder_type, status, coalesce(skip_reason, '')) where status in ('unmatched', 'invalid_contact')`
  ];

  for (const q of queries) {
    try {
      await pool.query(q);
    } catch (e) {
      // Ignorar errores si el objeto ya existe (a veces el IF NOT EXISTS falla en concurrencia)
      if (!e.message.includes("already exists")) {
        throw e;
      }
    }
  }
}

export async function logReminderEvent(config, payload) {
  const pool = getPostgresPool(config);
  await ensureMessageLogTable(config);

  await pool.query(
    `
      insert into whatsapp_message_log (
        appointment_id,
        reminder_type,
        template_name,
        patient_name,
        patient_email,
        patient_phone,
        starts_at,
        status,
        skip_reason,
        error_message,
        provider_message_id,
        meta_response
      )
      values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::jsonb
      )
    `,
    [
      payload.appointmentId,
      payload.reminderType,
      payload.templateName || null,
      payload.patientName || null,
      payload.patientEmail || null,
      payload.patientPhone || null,
      payload.startsAt || null,
      payload.status,
      payload.skipReason || null,
      payload.errorMessage || null,
      payload.providerMessageId || null,
      payload.metaResponse ? JSON.stringify(payload.metaResponse) : null,
    ]
  );
}

export async function logReminderDiagnostic(config, payload) {
  const pool = getPostgresPool(config);
  await ensureMessageLogTable(config);

  await pool.query(
    `
      insert into whatsapp_message_log (
        appointment_id,
        reminder_type,
        template_name,
        patient_name,
        patient_email,
        patient_phone,
        starts_at,
        status,
        skip_reason,
        error_message,
        provider_message_id,
        meta_response
      )
      values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::jsonb
      )
      on conflict (appointment_id, reminder_type, status, coalesce(skip_reason, ''))
      where status in ('unmatched', 'invalid_contact')
      do update set
        template_name = excluded.template_name,
        patient_name = excluded.patient_name,
        patient_email = excluded.patient_email,
        patient_phone = excluded.patient_phone,
        starts_at = excluded.starts_at,
        error_message = excluded.error_message,
        meta_response = excluded.meta_response,
        created_at = now()
    `,
    [
      payload.appointmentId,
      payload.reminderType || "eligibility",
      payload.templateName || null,
      payload.patientName || null,
      payload.patientEmail || null,
      payload.patientPhone || null,
      payload.startsAt || null,
      payload.status,
      payload.skipReason || null,
      payload.errorMessage || null,
      payload.providerMessageId || null,
      payload.metaResponse ? JSON.stringify(payload.metaResponse) : null,
    ]
  );
}

export async function fetchRecentMessageLog(config, limit = 20) {
  const pool = getPostgresPool(config);
  await ensureMessageLogTable(config);

  const { rows } = await pool.query(
    `
      select
        id,
        appointment_id,
        reminder_type,
        template_name,
        patient_name,
        patient_email,
        patient_phone,
        starts_at,
        status,
        skip_reason,
        error_message,
        provider_message_id,
        meta_response,
        created_at
      from whatsapp_message_log
      order by created_at desc
      limit $1
    `,
    [limit]
  );

  return rows;
}

export async function fetchTodayMessageLogStats(config) {
  const pool = getPostgresPool(config);
  await ensureMessageLogTable(config);

  const { rows } = await pool.query(
    `
      select
        status,
        reminder_type,
        skip_reason,
        count(*)::integer as count
      from whatsapp_message_log
      where created_at >= (date_trunc('day', now() at time zone $1) at time zone $1)
        and created_at < ((date_trunc('day', now() at time zone $1) + interval '1 day') at time zone $1)
      group by status, reminder_type, skip_reason
      order by status, reminder_type, skip_reason
    `,
    [config.timezone]
  );

  const totals = {
    sent: 0,
    failed: 0,
    skipped: 0,
    unmatched: 0,
    invalidContact: 0,
  };
  const byReminderType = {};
  const skipReasons = {};

  for (const row of rows) {
    const totalKey = row.status === "invalid_contact" ? "invalidContact" : row.status;
    if (Object.prototype.hasOwnProperty.call(totals, totalKey)) {
      totals[totalKey] += row.count;
    }

    byReminderType[row.reminder_type] ||= {
      sent: 0,
      failed: 0,
      skipped: 0,
      unmatched: 0,
      invalidContact: 0,
    };
    if (Object.prototype.hasOwnProperty.call(byReminderType[row.reminder_type], totalKey)) {
      byReminderType[row.reminder_type][totalKey] += row.count;
    }

    if (["skipped", "unmatched", "invalid_contact"].includes(row.status)) {
      const reason = row.skip_reason || "unknown";
      skipReasons[reason] = (skipReasons[reason] || 0) + row.count;
    }
  }

  return {
    totals,
    byReminderType,
    skipReasons,
    rows,
  };
}
