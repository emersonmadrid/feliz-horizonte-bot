export async function sendWhatsAppMessage({ to, text, config }) {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.apiToken) {
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
    recipient_type: 'individual',
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
