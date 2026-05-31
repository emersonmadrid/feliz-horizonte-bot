import { formatInTimeZone } from "date-fns-tz";
import { getPostgresPool } from "../integrations/postgres/client.js";

function getCurrentMonthKey(timezone) {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM");
}

function getCurrentDayKey(timezone) {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

export async function ensureMessageLimitTables(config) {
  const pool = getPostgresPool(config);

  await pool.query(`
    create table if not exists whatsapp_monthly_usage (
      month_key text primary key,
      sent_count integer not null default 0,
      warning_sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists whatsapp_daily_usage (
      day_key text primary key,
      sent_count integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create or replace function set_whatsapp_monthly_usage_updated_at()
    returns trigger
    language plpgsql
    as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;

    drop trigger if exists whatsapp_monthly_usage_set_updated_at on whatsapp_monthly_usage;
    drop trigger if exists whatsapp_daily_usage_set_updated_at on whatsapp_daily_usage;

    create trigger whatsapp_monthly_usage_set_updated_at
    before update on whatsapp_monthly_usage
    for each row
    execute function set_whatsapp_monthly_usage_updated_at();

    create trigger whatsapp_daily_usage_set_updated_at
    before update on whatsapp_daily_usage
    for each row
    execute function set_whatsapp_monthly_usage_updated_at();
  `);
}

export async function getMonthlyUsage(config) {
  const pool = getPostgresPool(config);
  const monthKey = getCurrentMonthKey(config.timezone);

  await ensureMessageLimitTables(config);

  const { rows } = await pool.query(
    `
      insert into whatsapp_monthly_usage (month_key)
      values ($1)
      on conflict (month_key) do nothing
      returning month_key, sent_count, warning_sent_at
    `,
    [monthKey]
  );

  if (rows[0]) {
    return rows[0];
  }

  const result = await pool.query(
    `
      select month_key, sent_count, warning_sent_at
      from whatsapp_monthly_usage
      where month_key = $1
    `,
    [monthKey]
  );

  return result.rows[0] || { month_key: monthKey, sent_count: 0, warning_sent_at: null };
}

export async function incrementMonthlyUsage(config, amount = 1) {
  const pool = getPostgresPool(config);
  const monthKey = getCurrentMonthKey(config.timezone);

  await ensureMessageLimitTables(config);

  const { rows } = await pool.query(
    `
      insert into whatsapp_monthly_usage (month_key, sent_count)
      values ($1, $2)
      on conflict (month_key)
      do update set sent_count = whatsapp_monthly_usage.sent_count + $2, updated_at = now()
      returning month_key, sent_count, warning_sent_at
    `,
    [monthKey, amount]
  );

  return rows[0];
}

export async function getDailyUsage(config) {
  const pool = getPostgresPool(config);
  const dayKey = getCurrentDayKey(config.timezone);

  await ensureMessageLimitTables(config);

  const { rows } = await pool.query(
    `
      insert into whatsapp_daily_usage (day_key)
      values ($1)
      on conflict (day_key) do nothing
      returning day_key, sent_count
    `,
    [dayKey]
  );

  if (rows[0]) {
    return rows[0];
  }

  const result = await pool.query(
    `
      select day_key, sent_count
      from whatsapp_daily_usage
      where day_key = $1
    `,
    [dayKey]
  );

  return result.rows[0] || { day_key: dayKey, sent_count: 0 };
}

export async function incrementDailyUsage(config, amount = 1) {
  const pool = getPostgresPool(config);
  const dayKey = getCurrentDayKey(config.timezone);

  await ensureMessageLimitTables(config);

  const { rows } = await pool.query(
    `
      insert into whatsapp_daily_usage (day_key, sent_count)
      values ($1, $2)
      on conflict (day_key)
      do update set sent_count = whatsapp_daily_usage.sent_count + $2, updated_at = now()
      returning day_key, sent_count
    `,
    [dayKey, amount]
  );

  return rows[0];
}

export async function markMonthlyWarningSent(config) {
  const pool = getPostgresPool(config);
  const monthKey = getCurrentMonthKey(config.timezone);

  await ensureMessageLimitTables(config);

  const { rows } = await pool.query(
    `
      insert into whatsapp_monthly_usage (month_key, warning_sent_at)
      values ($1, now())
      on conflict (month_key)
      do update set warning_sent_at = now(), updated_at = now()
      returning month_key, sent_count, warning_sent_at
    `,
    [monthKey]
  );

  return rows[0];
}

export function evaluateMessageLimit(config, usage) {
  const limit = config.monthlyMessageLimit;
  const warningThreshold = config.monthlyMessageWarningThreshold;

  if (!limit || limit <= 0) {
    return {
      enabled: false,
      limit: 0,
      sentCount: usage.sent_count || 0,
      warningThreshold,
      warningReached: false,
      limitReached: false,
      warningAlreadySent: Boolean(usage.warning_sent_at),
    };
  }

  const sentCount = usage.sent_count || 0;

  return {
    enabled: true,
    limit,
    sentCount,
    warningThreshold,
    warningReached: warningThreshold > 0 && sentCount >= warningThreshold,
    limitReached: sentCount >= limit,
    warningAlreadySent: Boolean(usage.warning_sent_at),
  };
}

export function evaluateDailyLimit(config, usage) {
  const limit = config.maxMessagesPerDay;
  const sentCount = usage.sent_count || 0;

  if (!limit || limit <= 0) {
    return {
      enabled: false,
      limit: 0,
      sentCount,
      limitReached: false,
    };
  }

  return {
    enabled: true,
    limit,
    sentCount,
    limitReached: sentCount >= limit,
  };
}
