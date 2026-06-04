# Limite del modulo reminder

Este documento define el limite tecnico y operativo del modulo de recordatorios. La intencion es evitar acoplarlo innecesariamente al chatbot y facilitar una futura extraccion a un proyecto independiente.

## Objetivo del modulo

El modulo reminder debe encargarse solo de:

- obtener citas desde una fuente configurada,
- normalizar esas citas,
- resolver datos minimos del paciente para enviar recordatorios,
- decidir si corresponde enviar recordatorio,
- enviar templates de WhatsApp,
- registrar estado, limites y auditoria,
- exponer endpoints operativos para cron, webhook y resumen.

No debe encargarse de conversacion, IA, atencion humana, Telegram topics ni aprendizaje del chatbot.

## Secuencia del reminder

```text
VPS systemd timer
 -> GET /api/cron/reminders
 -> validar CRON_SECRET
 -> cargar config del reminder
 -> sincronizar fuente de citas
 -> reconciliar canceladas/reprogramadas
 -> guardar whatsapp_appointments
 -> filtrar elegibles
 -> calcular ventanas day/hour
 -> validar limites
 -> enviar template WhatsApp
 -> marcar whatsapp_reminder_state
 -> registrar whatsapp_message_log
```

## Pertenece al reminder

### Endpoints

```text
GET  /api/cron/reminders
GET  /api/admin/summary
POST /api/webhooks/calendly
```

### Codigo

```text
api/cron/reminders.js
api/admin/summary.js
api/webhooks/calendly.js
src/services/reminders/**
```

### Tablas

```text
whatsapp_appointments
whatsapp_reminder_state
whatsapp_message_log
whatsapp_daily_usage
whatsapp_monthly_usage
```

### Conceptos de dominio

- appointment/cita,
- fuente de cita,
- elegibilidad,
- cancelacion,
- reprogramacion,
- recordatorio del dia,
- recordatorio de una hora antes,
- limite por corrida,
- limite diario,
- limite mensual,
- dry-run,
- auditoria de envio.

## No pertenece al reminder

Estas piezas pertenecen al chatbot o al canal inbound, no al modulo reminder puro:

```text
src/app.js
src/services/ai.service.js
src/services/conversation-history.service.js
src/services/learning.service.js
src/services/state.service.js
src/prompts/**
src/config/business-info.js
```

Tampoco pertenecen al reminder:

- Gemini,
- prompt del chatbot,
- historial conversacional,
- estado humano/IA,
- botones de bienvenida,
- Telegram topics,
- comandos `/aprender`, `/auto`, `/estado`, `/reactivar`,
- transcripcion de audio,
- forwarding de archivos entre WhatsApp y Telegram,
- endpoints admin legacy del chatbot.

## Dependencias permitidas

El reminder puede depender de:

- `pg` / Postgres,
- Google Calendar,
- Google Sheets,
- Calendly API,
- Calendly webhook,
- Meta WhatsApp Cloud API,
- variables de entorno propias,
- VPS como scheduler externo,
- Vercel como hosting temporal del endpoint.

## Dependencias compartidas aceptables por ahora

Estas dependencias se comparten con el chatbot por conveniencia operativa, pero no deben convertirse en dependencia de dominio:

- `WHATSAPP_API_TOKEN`,
- `WHATSAPP_PHONE_NUMBER_ID`,
- `DATABASE_URL`,
- infraestructura Vercel,
- repositorio GitHub,
- despliegue a produccion.

El reminder no debe importar funciones desde `src/app.js`.

## Acoplamientos temporales

### Modo inbound solo recordatorios

Existe:

```text
GLOBAL_MODE=reminders
src/modules/whatsapp-inbound/**
whatsapp_inbound_audit
```

Este modo redirige mensajes entrantes cuando el numero se usa solo para recordatorios. Esta relacionado operativamente con reminder, pero no es parte del motor de envio de recordatorios.

Para una futura extraccion, este modo puede quedar:

1. en el chatbot, como politica de inbound del numero,
2. o moverse al reminder-service si el numero queda dedicado solo a recordatorios.

Mientras siga dentro del bot, documentarlo como dependencia operacional, no como dominio del reminder.

### Admin summary

`/api/admin/summary` pertenece al reminder, pero actualmente puede sincronizar citas si `APPOINTMENT_SOURCE=calendly_api`, porque llama el flujo que lista recordatorios.

Esto es aceptable por ahora, pero no es ideal para auditoria pura.

Mejora futura recomendada:

```text
GET /api/admin/summary?readonly=true
```

Ese modo deberia leer solamente la base de datos y no sincronizar fuentes externas.

## Variables del reminder

Variables propias:

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
GOOGLE_CALENDAR_ID
GOOGLE_CALENDAR_CLIENT_EMAIL
GOOGLE_CALENDAR_PRIVATE_KEY
CALENDAR_TIMEZONE
GOOGLE_CALENDAR_LOOKAHEAD_DAYS
```

Variables que no deberian condicionar el dominio del reminder:

```text
GEMINI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_GROUP_CHAT_ID
TELEGRAM_ADMIN_CHAT_ID
ADMIN_SETUP_KEY
SUPABASE_URL
SUPABASE_KEY
CONVERSATION_HISTORY_TABLE
CONVERSATION_STATE_TABLE
CALENDLY_THERAPY_URL
CALENDLY_PSYCHIATRY_URL
```

## Variables legacy o confusas

En el entorno pueden existir:

```text
REMINDER_SAME_DAY_TEMPLATE
REMINDER_ONE_HOUR_TEMPLATE
```

El codigo actual usa:

```text
WHATSAPP_TEMPLATE_SAME_DAY
WHATSAPP_TEMPLATE_ONE_HOUR
```

Antes de tocar templates o migrar entornos, revisar `src/services/reminders/core/config.js`.

## Criterios para no acoplar mas

Antes de agregar una funcion al reminder, preguntar:

1. ¿Depende de conversaciones o IA?
2. ¿Depende de Telegram topics?
3. ¿Depende de comandos humanos del panel?
4. ¿Depende de `src/app.js`?
5. ¿Se puede probar sin levantar el chatbot?

Si la respuesta a 1-4 es "si", probablemente no pertenece al reminder.

Si la respuesta a 5 es "no", hay acoplamiento que corregir.

## Forma objetivo si se independiza

Estructura sugerida para un proyecto separado:

```text
feliz-horizonte-reminders
  api/
    cron/reminders.js
    admin/summary.js
    webhooks/calendly.js
  src/
    core/
    domain/
    integrations/
      calendly/
      google/
      postgres/
      whatsapp/
    persistence/
    services/
    sources/
  docs/
    REMINDER_BOUNDARY.md
    CALENDLY_REMINDERS.md
  package.json
  vercel.json
```

El chatbot podria seguir existiendo como proyecto separado:

```text
feliz-horizonte-bot
```

La comunicacion entre ambos deberia ser minima:

- comparten WhatsApp credentials,
- comparten base de datos o schema,
- comparten numero de produccion solo si el negocio lo decide,
- no comparten codigo de dominio.

## Plan gradual de extraccion

1. Mantener el reminder aislado dentro de `src/services/reminders`.
2. No importar nada desde `src/app.js`.
3. No mover logica de chatbot al reminder.
4. Convertir `/api/admin/summary` en opcion readonly cuando haga falta.
5. Limpiar variables legacy de templates.
6. Extraer el modulo a repo separado copiando `api/*` del reminder y `src/services/reminders`.
7. Configurar Vercel del nuevo servicio.
8. Actualizar el script del VPS para apuntar al nuevo endpoint.
9. Verificar con dry-run desde VPS.
10. Desactivar endpoints de reminder en el bot viejo cuando el nuevo servicio quede estable.

## Estado actual

El reminder esta funcionalmente separado a nivel de carpetas y flujo, pero sigue empaquetado dentro del proyecto del chatbot.

La arquitectura actual es aceptable para operar, pero el limite debe respetarse para que la futura extraccion no se vuelva costosa.
