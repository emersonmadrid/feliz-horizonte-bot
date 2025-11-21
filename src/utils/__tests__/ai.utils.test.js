import { describe, expect, it } from "vitest";
import { buildPrompt, sanitizeGeminiApiKey } from "../ai.utils.js";

describe("sanitizeGeminiApiKey", () => {
  it("elimina espacios y comillas", () => {
    const raw = "  'AIza123'  ";
    expect(sanitizeGeminiApiKey(raw)).toBe("AIza123");
  });

  it("retorna cadena vacía si es null o undefined", () => {
    expect(sanitizeGeminiApiKey(null)).toBe("");
    expect(sanitizeGeminiApiKey(undefined)).toBe("");
  });
});

describe("buildPrompt", () => {
  it("concatena prompt de negocio y contexto", () => {
    const prompt = buildPrompt({
      businessPrompt: "BASE",
      contextPrompt: "\nCTX",
      text: "Hola",
    });

    expect(prompt).toContain("BASE");
    expect(prompt).toContain("CTX");
    expect(prompt).toContain("\n\nMensaje actual del cliente:\n\"Hola\"\n\nRespuesta:");
  });

  it("funciona con argumentos vacíos", () => {
    const prompt = buildPrompt({});
    expect(prompt).toBe(`\n\nMensaje actual del cliente:\n""\n\nRespuesta:`);
  });
});
