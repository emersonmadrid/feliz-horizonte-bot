import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  CONVERSATION_STATE_TABLE,
  CONVERSATION_TTL_MINUTES,
  CONVERSATION_STATE_CLEANUP_MINUTES,
} = process.env;

const STATE_TABLE = CONVERSATION_STATE_TABLE || "fh_conversation_state";
const DEFAULT_TTL_MINUTES = 720; // 12 hours
const DEFAULT_CLEANUP_MINUTES = 5;

const ttlMinutes = Number(CONVERSATION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES);
const cleanupMinutes = Number(CONVERSATION_STATE_CLEANUP_MINUTES ?? DEFAULT_CLEANUP_MINUTES);
const TTL_MS = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : DEFAULT_TTL_MINUTES * 60 * 1000;
const CLEANUP_MS = Number.isFinite(cleanupMinutes) && cleanupMinutes > 0 ? cleanupMinutes * 60 * 1000 : DEFAULT_CLEANUP_MINUTES * 60 * 1000;

const DEFAULT_CONVERSATION_STATE = {
  lastMessageTime: 0,
  isHumanHandling: false,
  awaitingScheduling: false,
  lastIntent: null,
  context: null,
  buttonsSent: false,
  servicePreference: null,

  // Estados de confirmación de precio y pago
  priceConfirmed: false,
  paymentProcessExplained: false,
  awaitingPriceConfirmation: false,
  awaitingPaymentConfirmation: false,
  pendingService: null,
  pendingPrice: null,
};

const stateStore = new Map();
let expiredCount = 0;

let supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);
const supabase = supabaseEnabled ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

function normalizeState(state) {
  return { ...DEFAULT_CONVERSATION_STATE, ...(state || {}) };
}

function isExpired(entry) {
  return Date.now() - entry.updatedAt >= TTL_MS;
}

async function persistState(phone, state, updatedAt) {
  if (!supabaseEnabled || !supabase) return;

  try {
    await supabase.from(STATE_TABLE).upsert({
      phone,
      state,
      updated_at: new Date(updatedAt).toISOString(),
    });
  } catch (err) {
    supabaseEnabled = false;
    console.error("⚠️ No se pudo persistir el estado en Supabase:", err?.message || err);
  }
}

async function deleteRemoteState(phone) {
  if (!supabaseEnabled || !supabase) return;

  try {
    await supabase.from(STATE_TABLE).delete().eq("phone", phone);
  } catch (err) {
    supabaseEnabled = false;
    console.error("⚠️ No se pudo eliminar el estado en Supabase:", err?.message || err);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hydrateFromSupabase() {
  if (!supabaseEnabled || !supabase) return;

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const cutoff = new Date(Date.now() - TTL_MS).toISOString();
      const { data, error } = await supabase
        .from(STATE_TABLE)
        .select("phone, state, updated_at")
        .gte("updated_at", cutoff);

      if (error) throw error;

      data?.forEach(({ phone, state, updated_at }) => {
        const updatedAt = updated_at ? new Date(updated_at).getTime() : Date.now();
        stateStore.set(phone, { state: normalizeState(state), updatedAt });
      });

      console.log(`💾 Estado cargado desde Supabase: ${stateStore.size} conversaciones activas`);
      return;
    } catch (err) {
      const attemptMsg = `Intento ${attempt}/${maxAttempts}`;
      console.debug(`⚠️ No se pudo hidratar el estado desde Supabase (${attemptMsg}):`, err?.message || err);
      if (attempt < maxAttempts) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        await wait(backoffMs);
      }
    }
  }
}

async function cleanupExpiredStates() {
  const now = Date.now();
  const deletions = [];

  for (const [phone, entry] of stateStore.entries()) {
    if (now - entry.updatedAt >= TTL_MS) {
      stateStore.delete(phone);
      expiredCount += 1;
      deletions.push(deleteRemoteState(phone));
    }
  }

  if (deletions.length) {
    await Promise.allSettled(deletions);
  }
}

setInterval(() => {
  cleanupExpiredStates().catch((err) => console.error("⚠️ Limpieza de estado falló:", err?.message || err));
}, CLEANUP_MS).unref?.();

hydrateFromSupabase();

export async function getConversationState(phone) {
  await cleanupExpiredStates();

  const existing = stateStore.get(phone);
  if (existing && !isExpired(existing)) {
    return existing.state;
  }

  if (supabaseEnabled && supabase) {
    try {
      const cutoff = new Date(Date.now() - TTL_MS).toISOString();
      const { data, error } = await supabase
        .from(STATE_TABLE)
        .select("state, updated_at")
        .eq("phone", phone)
        .gte("updated_at", cutoff)
        .maybeSingle();

      if (error) throw error;

      if (data?.state) {
        const updatedAt = data.updated_at ? new Date(data.updated_at).getTime() : Date.now();
        const normalized = normalizeState(data.state);
        stateStore.set(phone, { state: normalized, updatedAt });
        return normalized;
      }
    } catch (err) {
      supabaseEnabled = false;
      console.error("⚠️ No se pudo recuperar el estado desde Supabase:", err?.message || err);
    }
  }

  return null;
}

export async function mergeConversationState(phone, updates = {}) {
  const current = (await getConversationState(phone)) || normalizeState();
  const next = { ...current, ...updates };
  const updatedAt = Date.now();

  stateStore.set(phone, { state: next, updatedAt });
  await persistState(phone, next, updatedAt);

  return next;
}

export async function deleteConversationState(phone) {
  stateStore.delete(phone);
  await deleteRemoteState(phone);
}

export async function listActiveConversations() {
  await cleanupExpiredStates();
  return Array.from(stateStore.entries()).map(([phone, entry]) => ({
    phone,
    state: entry.state,
    updatedAt: entry.updatedAt,
  }));
}

export function getStateMetrics() {
  return {
    activeConversations: stateStore.size,
    expiredConversations: expiredCount,
    ttlMinutes: Math.round(TTL_MS / 60000),
  };
}
