import { describe, expect, it } from "vitest";
import { generateAIReply } from "../ai.service.js";

describe("Detección de servicios no disponibles", () => {
  it("detecta terapia para autismo y deriva a humano", async () => {
    const result = await generateAIReply({
      text: "¿hacen terapia para niños autistas?",
      conversationContext: null,
      phone: "51999999999"
    });

    expect(result.meta.intent).toBe("servicio_no_disponible");
    expect(result.meta.notify_human).toBe(true);
    expect(result.meta.priority).toBe("high");
    expect(result.message).toContain("no contamos con ese servicio");
  });

  it("detecta neuropsicología y deriva", async () => {
    const result = await generateAIReply({
      text: "necesito evaluación neuropsicológica",
      conversationContext: null,
      phone: "51999999999"
    });

    expect(result.meta.intent).toBe("servicio_no_disponible");
    expect(result.meta.notify_human).toBe(true);
  });
});
