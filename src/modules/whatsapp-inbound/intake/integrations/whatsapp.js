export async function sendWhatsAppMessage({ to, text, config }) {
  if (!config?.whatsapp?.phoneNumberId || !config?.whatsapp?.apiToken) {
    console.warn('⚠️ WhatsApp API no configurado, mensaje no enviado:', text);
    return { ok: false, reason: 'whatsapp_not_configured' };
  }

  // Limpiar número (asegurar prefijo 51 para Perú si tiene 9 dígitos)
  let cleanTo = String(to).replace(/\D/g, '');
  if (cleanTo.length === 9 && cleanTo.startsWith('9')) {
    cleanTo = '51' + cleanTo;
  }

  const url = `https://graph.facebook.com/v20.0/${config.whatsapp.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: cleanTo,
    type: 'text',
    text: { body: text }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsapp.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Error enviando WhatsApp a ${cleanTo}:`, err);
      return { ok: false, error: err };
    }

    const data = await res.json();
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    console.error('Error de red al enviar WhatsApp:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function sendWhatsAppButtons({ to, text, buttons, footer = '', config }) {
  if (!config?.whatsapp?.phoneNumberId || !config?.whatsapp?.apiToken) {
    console.warn('⚠️ WhatsApp API no configurado, botones no enviados:', text);
    return { ok: false, reason: 'whatsapp_not_configured' };
  }

  let cleanTo = String(to).replace(/\D/g, '');
  if (cleanTo.length === 9 && cleanTo.startsWith('9')) {
    cleanTo = '51' + cleanTo;
  }

  const url = `https://graph.facebook.com/v20.0/${config.whatsapp.phoneNumberId}/messages`;
  const interactivePayload = {
    type: 'button',
    body: { text },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title.slice(0, 20) },
      })),
    },
  };

  if (footer) {
    interactivePayload.footer = { text: footer.slice(0, 60) };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsapp.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'interactive',
        interactive: interactivePayload,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn('⚠️ Error de Meta al enviar botones, usando texto alternativo:', err);
      const fallbackText = `${text}\n\n` + buttons.map((b, i) => `${i + 1}️⃣ ${b.title}`).join('\n');
      return await sendWhatsAppMessage({ to: cleanTo, text: fallbackText, config });
    }

    const data = await res.json();
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    console.warn('⚠️ Error de red al enviar botones WhatsApp, usando texto alternativo:', e.message);
    const fallbackText = `${text}\n\n` + buttons.map((b, i) => `${i + 1}️⃣ ${b.title}`).join('\n');
    return await sendWhatsAppMessage({ to: cleanTo, text: fallbackText, config });
  }
}
