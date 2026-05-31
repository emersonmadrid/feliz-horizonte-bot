# Calendly como fuente de recordatorios

Este proyecto soporta tres modos de fuente de citas:

- `APPOINTMENT_SOURCE=google`: comportamiento actual. El cron sincroniza Google Calendar + Google Sheets.
- `APPOINTMENT_SOURCE=calendly_api`: el cron consulta Calendly API + Google Sheets. No requiere webhook pagado.
- `APPOINTMENT_SOURCE=calendly`: las citas se alimentan desde webhooks de Calendly guardados en `whatsapp_appointments`.
- `APPOINTMENT_SOURCE=hybrid`: mantiene Google activo y además acepta Calendly. El envío deduplica por paciente y hora de cita para evitar dobles recordatorios.

## Endpoint

Configura en Calendly este callback:

```text
https://feliz-horizonte-bot.vercel.app/api/webhooks/calendly?token=CALENDLY_WEBHOOK_SECRET
```

Eventos a suscribir:

- `invitee.created`
- `invitee.canceled`

## Variables

Modo recomendado si Calendly está en plan gratis:

```env
APPOINTMENT_SOURCE=calendly_api
CALENDLY_API_TOKEN=personal_access_token_de_calendly
CALENDLY_TIMEZONE=America/Lima
CALENDLY_LOOKAHEAD_DAYS=7
```

Modo webhook si Calendly tiene plan Standard o superior:

```env
APPOINTMENT_SOURCE=calendly
CALENDLY_WEBHOOK_SECRET=un_token_largo_y_privado
CALENDLY_TIMEZONE=America/Lima
```

Para transición sin apagar Google:

```env
APPOINTMENT_SOURCE=hybrid
```

Cuando ya confirmes que Calendly está enviando bien los webhooks, puedes cambiar a:

```env
APPOINTMENT_SOURCE=calendly
```

## Datos del paciente

Calendly es la fuente de la cita, pero Google Sheet sigue siendo el directorio maestro de pacientes.

El webhook toma el email desde Calendly y busca ese email en la hoja `Pacientes`.

Si encuentra el paciente, usa:

- Nombre del Google Sheet
- Teléfono del Google Sheet

Si el teléfono del Sheet está vacío, como respaldo intenta tomar el teléfono desde Calendly:

- `text_reminder_number`
- `phone_number`
- respuestas de preguntas que contengan `telefono`, `teléfono`, `celular`, `whatsapp`, `phone` o `mobile`

Si el email de Calendly no existe en el Sheet, la cita queda como `unmatched`.
Si el email existe pero el teléfono está vacío o inválido, queda como `invalid_contact`.

## Flujo

Modo `calendly_api`:

1. El cron existente del VPS llama `/api/cron/reminders`.
2. El sistema consulta Calendly API por próximas citas.
3. El sistema cruza cada email contra Google Sheet.
4. Guarda/actualiza la cita en `whatsapp_appointments`.
5. El motor envía recordatorios cuando corresponda.

Modo `calendly` por webhook:

1. Calendly recibe una reserva.
2. Calendly llama a `/api/webhooks/calendly`.
3. El sistema guarda/actualiza la cita en `whatsapp_appointments`.
4. El cron existente del VPS sigue llamando `/api/cron/reminders`.
5. El motor lee citas elegibles desde la base y envía WhatsApp según las reglas actuales.

El webhook no envía mensajes directamente. Solo registra la cita. Esto mantiene control de límites, logs y reintentos en un solo lugar.

## Cancelaciones

Cuando llega `invitee.canceled`, la cita se marca como:

- `calendar_status=cancelled`
- `eligibility_status=cancelled`
- `skip_reason=appointment_cancelled`

Las citas canceladas no son elegibles para envío.
