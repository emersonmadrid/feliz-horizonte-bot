export function getBotMode(useWebhook) {
  return useWebhook ? "webhook" : "polling";
}

export function buildHealthPayload({ supabaseStatus, telegramStatus, mode, extra = {} }) {
  const supabase = supabaseStatus ?? { ok: false };
  const telegram = telegramStatus ?? { ok: false };
  const ok = Boolean(supabase.ok) && Boolean(telegram.ok);

  return {
    supabase,
    telegram,
    mode,
    ok,
    ...extra,
  };
}
