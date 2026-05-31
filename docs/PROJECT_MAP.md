# Mapa operativo del proyecto

Este documento es la fuente de verdad para orientarse antes de modificar el proyecto. Revisarlo antes de crear endpoints, modulos o flujos nuevos.

## Resumen

`feliz-horizonte-bot` contiene dos subsistemas principales:

1. Bot conversacional de WhatsApp/Telegram.
2. Modulo de recordatorios de citas.

Ambos se despliegan en Vercel, pero el disparador periodico de recordatorios vive en un VPS.

## Entradas HTTP

### Bot principal

Implementado en `src/app.js`.

Endpoints:

```text
GET  /
GET  /health
POST /telegram/webhook
GET  /webhook/whatsapp
POST /webhook/whatsapp
POST /admin/clean-topic
GET  /admin/list-topics
POST /admin/reset-conversation
GET  /admin/active-conversations
GET  /admin/state-metrics
GET  /admin/learned-responses
POST /admin/delete-learned-response
POST /admin/sync-topics
```

Autenticacion admin legacy:

```text
ADMIN_SETUP_KEY
```

### Reminder

Implementado en `api/*` y `src/services/reminders`.

Endpoints:

```text
GET  /api/cron/reminders
GET  /api/admin/summary
POST /api/webhooks/calendly
```

Autenticacion:

```text
CRON_SECRET      -> /api/cron/reminders
ADMIN_API_KEY    -> /api/admin/summary
CRON_SECRET      -> tambien sirve como fallback para /api/admin/summary
CALENDLY_WEBHOOK_SECRET -> /api/webhooks/calendly
```

## Despliegue real

### Vercel

Vercel compila y aloja el bot.

`vercel.json` solo define rewrites:

```text
/api/cron/reminders       -> api/cron/reminders.js
/api/admin/summary        -> api/admin/summary.js
/api/webhooks/calendly    -> api/webhooks/calendly.js
/(.*)                     -> src/app.js
```

No hay cron configurado en Vercel.

### VPS

El cron real vive en el VPS:

```text
host: 178.128.177.145
usuario: root
timer: feliz-horizonte-reminders.timer
service: feliz-horizonte-reminders.service
script: /usr/local/bin/feliz-horizonte-reminders.sh
```

El VPS llama cada 5 minutos:

```text
https://feliz-horizonte-bot.vercel.app/api/cron/reminders
```

`CRON_SECRET` no crea un cron en Vercel. Solo autoriza el endpoint para que no pueda dispararlo cualquiera con la URL.

## Bot conversacional

Archivo principal:

```text
src/app.js
```

Responsabilidades actuales:

- recibir mensajes WhatsApp,
- verificar webhook de WhatsApp,
- recibir webhook de Telegram en produccion,
- usar polling de Telegram localmente,
- crear y mantener topics de Telegram por telefono,
- reenviar mensajes Telegram -> WhatsApp,
- reenviar archivos WhatsApp -> Telegram,
- manejar audio entrante y respuesta de audio opcional,
- manejar estado humano/IA,
- detectar emergencias,
- bloquear lenguaje ofensivo desde panel,
- generar respuestas con Gemini,
- consultar disponibilidad de Google Calendar para el chatbot,
- administrar respuestas aprendidas,
- exponer endpoints admin legacy.

Servicios relacionados:

```text
src/services/ai.service.js
src/services/calendar.service.js
src/services/conversation-history.service.js
src/services/learning.service.js
src/services/state.service.js
src/prompts/*
src/config/business-info.js
```

## Reminder

Carpeta principal:

```text
src/services/reminders
```

Capas actuales:

```text
core/          configuracion y tiempo
domain/        reglas del motor y reconciliacion
integrations/  Calendly, Google, Postgres, WhatsApp
persistence/   tablas y queries
services/      resumen admin
sources/       normalizadores/sincronizadores de citas
lib/           re-exports legacy
```

Endpoints:

```text
api/cron/reminders.js
api/admin/summary.js
api/webhooks/calendly.js
```

Tablas principales:

```text
whatsapp_appointments
whatsapp_reminder_state
whatsapp_message_log
whatsapp_daily_usage
whatsapp_monthly_usage
whatsapp_inbound_audit
```

## Fuentes de citas

`APPOINTMENT_SOURCE` soporta:

```text
google        -> Google Calendar + Google Sheets
calendly_api  -> Calendly API + Google Sheets
calendly      -> Webhook Calendly + Google Sheets
hybrid        -> Google + Calendly con deduplicacion
```

Modo actual recomendado para Calendly gratis:

```text
APPOINTMENT_SOURCE=calendly_api
```

En ese modo, cada ejecucion del cron:

1. consulta Calendly API,
2. consulta Google Sheets para resolver paciente,
3. upsertea citas en `whatsapp_appointments`,
4. marca como canceladas las citas futuras de Calendly que ya no aparecen activas,
5. lista elegibles,
6. envia templates si corresponde y si no hay dry-run.

## Reprogramaciones Calendly

En modo `calendly_api`, una reprogramacion puede crear un nuevo ID y hacer desaparecer la cita vieja de eventos activos.

La reconciliacion vive en:

```text
src/services/reminders/domain/reminders/reconciliation.js
src/services/reminders/persistence/appointments.js
```

Cuando una cita futura de Calendly ya no aparece en el snapshot activo:

```text
calendar_status=cancelled
eligibility_status=cancelled
skip_reason=calendly_api_missing_from_active_events
```

Esto evita enviar recordatorios para el horario viejo.

## Dry-run

El cron acepta:

```text
GET /api/cron/reminders?dry_run=true
```

Dry-run:

- sincroniza citas reales,
- puede actualizar `whatsapp_appointments`,
- cancela citas viejas si Calendly ya no las devuelve,
- calcula recordatorios elegibles,
- no llama a Meta WhatsApp,
- no marca `day_sent_at` ni `hour_sent_at`,
- no escribe filas en `whatsapp_message_log`.

Prueba real desde el VPS sin exponer secreto:

```bash
SECRET=$(sed -n 's/.*Authorization: Bearer \([^"]*\).*/\1/p' /usr/local/bin/feliz-horizonte-reminders.sh)
curl -H "Authorization: Bearer ${SECRET}" \
  "https://feliz-horizonte-bot.vercel.app/api/cron/reminders?dry_run=true"
```

## Admin summary

Ya existe auditoria/resumen operativo:

```text
GET /api/admin/summary
```

Devuelve:

- estado de recordatorios,
- dry-run activo o no,
- limites diarios/mensuales,
- estadisticas de mensajes de hoy,
- citas elegibles ahora,
- proximas citas pendientes,
- resumen operativo de `whatsapp_appointments`,
- issues de citas,
- inbound audit,
- logs recientes.

Importante: si `APPOINTMENT_SOURCE=calendly_api`, consultar el summary llama internamente `listReminderAppointments(config)`, y eso sincroniza Calendly. No envia WhatsApp ni marca enviados, pero puede actualizar `whatsapp_appointments`.

No crear otro endpoint de auditoria sin revisar primero si `/api/admin/summary` puede extenderse.

## Modo solo recordatorios

Existe un modo inbound especial:

```text
GLOBAL_MODE=reminders
```

Implementado en:

```text
src/modules/whatsapp-inbound/router.js
src/modules/whatsapp-inbound/reminder-only-handler.js
src/modules/whatsapp-inbound/inbound-audit.js
```

Cuando esta activo:

- el webhook de WhatsApp no entra al chatbot,
- responde con redireccion a `REDIRECT_PHONE`,
- registra auditoria en `whatsapp_inbound_audit` si hay `DATABASE_URL`.

No duplicar este modo con otro handler nuevo.

## Variables importantes

### Bot principal

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
TELEGRAM_GROUP_CHAT_ID
TELEGRAM_TOPIC_ID_DEFAULT
SUPABASE_URL
SUPABASE_KEY
WHATSAPP_API_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_WEBHOOK_VERIFY_TOKEN
GEMINI_API_KEY
PUBLIC_URL
ADMIN_SETUP_KEY
GLOBAL_MODE
REDIRECT_PHONE
```

### Reminder

```text
APPOINTMENT_SOURCE
CRON_SECRET
ADMIN_API_KEY
DATABASE_URL
DIRECT_URL
APP_TIMEZONE
DAY_REMINDER_HOUR
HOUR_REMINDER_LEAD_MINUTES
HOUR_REMINDER_WINDOW_MINUTES
REMINDERS_ENABLED
REMINDERS_DRY_RUN
MAX_MESSAGES_PER_RUN
MAX_MESSAGES_PER_DAY
MONTHLY_MESSAGE_LIMIT
MONTHLY_MESSAGE_WARNING_THRESHOLD
WHATSAPP_TEMPLATE_SAME_DAY
WHATSAPP_TEMPLATE_ONE_HOUR
WHATSAPP_LANGUAGE_CODE
CALENDLY_API_TOKEN
CALENDLY_WEBHOOK_SECRET
CALENDLY_TIMEZONE
CALENDLY_LOOKAHEAD_DAYS
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SHEETS_SHEET_NAME
GOOGLE_SHEETS_EMAIL_COLUMN
GOOGLE_SHEETS_PHONE_COLUMN
GOOGLE_SHEETS_FIRST_NAME_COLUMN
GOOGLE_SHEETS_LAST_NAME_COLUMN
```

## Variables legacy o confusas

En Vercel aparecen variables antiguas:

```text
REMINDER_SAME_DAY_TEMPLATE
REMINDER_ONE_HOUR_TEMPLATE
```

El codigo actual del reminder usa:

```text
WHATSAPP_TEMPLATE_SAME_DAY
WHATSAPP_TEMPLATE_ONE_HOUR
```

Antes de tocar templates, verificar cual esta en uso en `src/services/reminders/core/config.js`.

## Archivos legacy o no usados

No asumir que estos archivos son la fuente de verdad:

```text
src/services/reminders/lib/*
```

Son re-exports de compatibilidad.

Tambien existen archivos vacios o utilidades no integradas:

```text
src/utils/env-validator.js
src/utils/formatters.js
src/utils/validators.js
```

`src/utils/validators.js` duplica ideas que hoy estan implementadas directamente en `src/app.js`, como lenguaje ofensivo y emergencia.

## Tests

Suite:

```bash
npm test
```

Cobertura actual:

- utilidades de IA,
- health utils,
- normalizacion Google/Calendly para reminders,
- reconciliacion de Calendly API,
- dry-run summary,
- modo inbound solo recordatorios,
- servicio no disponible.

Antes de tocar reminder, correr `npm test`.

## No duplicar

Antes de crear algo nuevo, revisar:

- Auditoria reminder: `/api/admin/summary`.
- Estado de conversaciones: `/admin/active-conversations` y `/admin/state-metrics`.
- Health: `/health`.
- Topics Telegram: `/admin/list-topics`, `/admin/sync-topics`, `/admin/clean-topic`.
- Respuestas aprendidas: `/aprender`, `/ver_aprendido`, `/admin/learned-responses`.
- Modo solo recordatorios: `GLOBAL_MODE=reminders`.
- Dry-run de reminder: `/api/cron/reminders?dry_run=true`.
- Scheduler de reminder: VPS `feliz-horizonte-reminders.timer`.

## Zonas de riesgo

- `src/app.js` es un monolito grande; cambios ahi tienen alto riesgo.
- El summary del reminder puede mutar citas en modo `calendly_api`.
- Hay varios archivos `.env*` locales; no asumir que coinciden con Vercel o VPS.
- Vercel aloja el endpoint, pero el VPS dispara recordatorios.
- El bot principal tiene sus propios helpers de WhatsApp; reminder tiene otra integracion WhatsApp para templates.
- Las variables de templates tienen nombres legacy y nombres actuales.

## Orden recomendado para cambios futuros

1. Revisar este documento.
2. Revisar el endpoint o modulo existente relacionado.
3. Confirmar si el cambio pertenece al bot principal o al reminder.
4. Evitar crear endpoint nuevo si se puede extender uno existente.
5. Agregar prueba cuando se toque logica de negocio.
6. Ejecutar `npm test`.
7. Actualizar documentacion si cambia arquitectura, entorno o flujo operativo.
