import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_PROMPT_BUCKET,
  SUPABASE_PROMPT_PATH,
  PROMPT_FILE_PATH,
} = process.env;

const DEFAULT_LOCAL_PATH = path.resolve(new URL("./business-info.md", import.meta.url).pathname);

function computeVersion(promptText) {
  return crypto.createHash("sha256").update(promptText, "utf8").digest("hex").slice(0, 12);
}

function ensureValidPrompt(promptText, sourceLabel) {
  const cleanPrompt = (promptText || "").trim();
  if (!cleanPrompt) {
    throw new Error(`Prompt vacío desde ${sourceLabel}`);
  }

  if (!cleanPrompt.includes("FORMATO DE RESPUESTA")) {
    throw new Error(`Prompt sin sección 'FORMATO DE RESPUESTA' desde ${sourceLabel}`);
  }

  if (!cleanPrompt.includes("\"intent\"")) {
    throw new Error(`Prompt sin pista de metadata JSON desde ${sourceLabel}`);
  }

  return cleanPrompt;
}

async function loadFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_PROMPT_BUCKET || !SUPABASE_PROMPT_PATH) {
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase.storage.from(SUPABASE_PROMPT_BUCKET).download(SUPABASE_PROMPT_PATH);

  if (error) {
    throw new Error(`Supabase storage error: ${error.message}`);
  }

  const promptBuffer = await data.arrayBuffer();
  const promptText = Buffer.from(promptBuffer).toString("utf8");

  const cleanPrompt = ensureValidPrompt(promptText, `supabase:${SUPABASE_PROMPT_BUCKET}/${SUPABASE_PROMPT_PATH}`);
  const versionTag = computeVersion(cleanPrompt);

  return {
    prompt: cleanPrompt,
    versionTag,
    source: `supabase:${SUPABASE_PROMPT_BUCKET}/${SUPABASE_PROMPT_PATH}`,
  };
}

async function loadFromFile() {
  const resolvedPath = PROMPT_FILE_PATH
    ? path.resolve(process.cwd(), PROMPT_FILE_PATH)
    : DEFAULT_LOCAL_PATH;

  const promptText = await fs.readFile(resolvedPath, "utf8");
  const cleanPrompt = ensureValidPrompt(promptText, `file:${resolvedPath}`);
  const versionTag = computeVersion(cleanPrompt);

  return {
    prompt: cleanPrompt,
    versionTag,
    source: `file:${resolvedPath}`,
  };
}

async function loadPrompt() {
  try {
    const remote = await loadFromSupabase();
    if (remote) {
      console.info(`🧠 Prompt cargado desde ${remote.source} (v=${remote.versionTag})`);
      return remote;
    }
    console.info("ℹ️ Prompt remoto no configurado, usando archivo local.");
  } catch (err) {
    console.warn(`⚠️ No se pudo cargar el prompt remoto: ${err.message}. Se usará el fallback local.`);
  }

  try {
    const local = await loadFromFile();
    console.info(`🧠 Prompt cargado desde ${local.source} (v=${local.versionTag})`);
    return local;
  } catch (err) {
    console.error(`❌ Error cargando prompt local: ${err.message}`);
    throw err;
  }
}

const promptStatePromise = loadPrompt();
let cachedPromptState = null;

promptStatePromise
  .then((state) => {
    cachedPromptState = state;
  })
  .catch(() => {
    // El error ya se registró en loadPrompt; se volverá a lanzar al primer consumo.
  });

export async function getPromptConfig() {
  if (cachedPromptState) {
    return cachedPromptState;
  }

  cachedPromptState = await promptStatePromise;
  return cachedPromptState;
}
