import { getPostgresPool } from "../../services/reminders/integrations/postgres/client.js";

export async function ensureInboundAuditTable(config) {
  if (!config?.databaseUrl) {
    return false;
  }

  const pool = getPostgresPool(config);

  await pool.query(`
    create table if not exists whatsapp_inbound_audit (
      id bigserial primary key,
      phone text not null,
      message_text text,
      message_type text,
      route text not null,
      action text not null,
      status text not null default 'handled',
      metadata jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists whatsapp_inbound_audit_created_at_idx
      on whatsapp_inbound_audit (created_at desc);

    create index if not exists whatsapp_inbound_audit_phone_idx
      on whatsapp_inbound_audit (phone, created_at desc);

    create index if not exists whatsapp_inbound_audit_route_idx
      on whatsapp_inbound_audit (route, created_at desc);
  `);

  return true;
}

export async function logInboundAudit(config, payload) {
  if (!config?.databaseUrl) {
    return null;
  }

  await ensureInboundAuditTable(config);

  const pool = getPostgresPool(config);
  const { rows } = await pool.query(
    `
      insert into whatsapp_inbound_audit (
        phone,
        message_text,
        message_type,
        route,
        action,
        status,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      returning id, created_at
    `,
    [
      payload.phone,
      payload.messageText || null,
      payload.messageType || null,
      payload.route,
      payload.action,
      payload.status || "handled",
      payload.metadata ? JSON.stringify(payload.metadata) : null,
    ]
  );

  return rows[0] || null;
}

export async function safeLogInboundAudit(config, payload) {
  try {
    return await logInboundAudit(config, payload);
  } catch (error) {
    console.error("⚠️ No se pudo registrar auditoría inbound:", error?.message || error);
    return null;
  }
}

export async function fetchRecentInboundAudit(config, limit = 20) {
  if (!config?.databaseUrl) {
    return [];
  }

  await ensureInboundAuditTable(config);

  const pool = getPostgresPool(config);
  const { rows } = await pool.query(
    `
      select
        id,
        phone,
        message_text,
        message_type,
        route,
        action,
        status,
        metadata,
        created_at
      from whatsapp_inbound_audit
      order by created_at desc
      limit $1
    `,
    [limit]
  );

  return rows;
}

export async function fetchTodayInboundAuditStats(config) {
  if (!config?.databaseUrl) {
    return { totals: {}, rows: [] };
  }

  await ensureInboundAuditTable(config);

  const pool = getPostgresPool(config);
  const { rows } = await pool.query(
    `
      select
        route,
        action,
        status,
        count(*)::integer as count
      from whatsapp_inbound_audit
      where created_at >= (date_trunc('day', now() at time zone $1) at time zone $1)
        and created_at < ((date_trunc('day', now() at time zone $1) + interval '1 day') at time zone $1)
      group by route, action, status
      order by route, action, status
    `,
    [config.timezone]
  );

  const totals = {};
  for (const row of rows) {
    const key = `${row.route}:${row.action}:${row.status}`;
    totals[key] = row.count;
  }

  return { totals, rows };
}
