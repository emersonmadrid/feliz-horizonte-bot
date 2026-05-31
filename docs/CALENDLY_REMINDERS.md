# Recordatorios de citas

> Para el mapa completo del proyecto, endpoints existentes y zonas que no conviene duplicar, revisar `docs/PROJECT_MAP.md`.

Este modulo vive dentro de `feliz-horizonte-bot` y envia recordatorios de citas por WhatsApp usando Vercel como API de produccion. El VPS no contiene la logica de negocio: solo llama periodicamente el endpoint del cron.

## Componentes

- `Vercel`: ejecuta `/api/cron/reminders`, `/api/webhooks/calendly` y `/api/admin/summary`.
- `VPS`: ejecuta un `systemd timer` cada 5 minutos y llama el cron de Vercel.
- `Google Calendar`: fuente de citas en modo `google` o `hybrid`.
- `Calendly`: fuente de citas en modo `calendly_api`, `calendly` o `hybrid`.
- `Google Sheets`: directorio maestro de pacientes; se usa para resolver nombre y telefono.
- `Postgres`: guarda citas normalizadas, estado de recordatorios, logs y limites.
- `Meta WhatsApp Cloud API`: envia los templates aprobados.

## Endpoints

Produccion actual:

```text
https://feliz-horizonte-bot.vercel.app
```

Endpoints principales:

```text
GET  /api/cron/reminders
POST /api/webhooks/calendly
GET  /api/admin/summary
```

El VPS debe llamar:

```text
https://feliz-horizonte-bot.vercel.app/api/cron/reminders
```

Autenticacion del cron:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://feliz-horizonte-bot.vercel.app/api/cron/reminders
```

Tambien se acepta:

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  https://feliz-horizonte-bot.vercel.app/api/cron/reminders
```

`CRON_SECRET` no crea ni configura un cron en Vercel. Es una llave privada para autorizar el endpoint `/api/cron/reminders`.

En esta arquitectura:

- el cron real vive en el VPS como `feliz-horizonte-reminders.timer`,
- el VPS llama el endpoint de Vercel cada 5 minutos,
- Vercel valida `CRON_SECRET`,
- si el secreto coincide, ejecuta el motor de recordatorios,
- si falta o no coincide, responde `401 Unauthorized`.

Esto evita que cualquier persona con la URL pueda disparar recordatorios manualmente.

## Fuentes de citas

El sistema soporta cuatro modos:

- `APPOINTMENT_SOURCE=google`: comportamiento actual. El cron sincroniza Google Calendar + Google Sheets.
- `APPOINTMENT_SOURCE=calendly_api`: el cron consulta Calendly API + Google Sheets. No requiere webhook pagado.
- `APPOINTMENT_SOURCE=calendly`: las citas se alimentan desde webhooks de Calendly guardados en `whatsapp_appointments`.
- `APPOINTMENT_SOURCE=hybrid`: mantiene Google activo y además acepta Calendly. El envío deduplica por paciente y hora de cita para evitar dobles recordatorios.

## Calendly webhook

Configura en Calendly este callback:

```text
https://feliz-horizonte-bot.vercel.app/api/webhooks/calendly?token=CALENDLY_WEBHOOK_SECRET
```

Eventos a suscribir:

- `invitee.created`
- `invitee.canceled`

El webhook no envia mensajes directamente. Solo registra o actualiza la cita en `whatsapp_appointments`. El envio real siempre lo hace `/api/cron/reminders`, para mantener limites, logs y reintentos en un solo lugar.

## Variables principales

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

Variables comunes del motor:

```env
CRON_SECRET=token_privado_del_cron
DATABASE_URL=postgres_connection_string
APP_TIMEZONE=America/Lima
DAY_REMINDER_HOUR=8
HOUR_REMINDER_LEAD_MINUTES=60
HOUR_REMINDER_WINDOW_MINUTES=5
REMINDERS_ENABLED=true
REMINDERS_DRY_RUN=false
MAX_MESSAGES_PER_RUN=5
MAX_MESSAGES_PER_DAY=20
MONTHLY_MESSAGE_LIMIT=200
MONTHLY_MESSAGE_WARNING_THRESHOLD=160
WHATSAPP_TEMPLATE_SAME_DAY=appointment_today
WHATSAPP_TEMPLATE_ONE_HOUR=appointment_soon
WHATSAPP_LANGUAGE_CODE=es_PE
```

## Datos del paciente

Calendly es la fuente de la cita, pero Google Sheet sigue siendo el directorio maestro de pacientes.

El sistema toma el email desde Calendly o Google Calendar y busca ese email en la hoja `Pacientes`.

Si encuentra el paciente, usa:

- Nombre del Google Sheet
- Teléfono del Google Sheet

Si el teléfono del Sheet está vacío, como respaldo intenta tomar el teléfono desde Calendly:

- `text_reminder_number`
- `phone_number`
- respuestas de preguntas que contengan `telefono`, `teléfono`, `celular`, `whatsapp`, `phone` o `mobile`

Si el email de Calendly no existe en el Sheet, la cita queda como `unmatched`.
Si el email existe pero el teléfono está vacío o inválido, queda como `invalid_contact`.

## Flujo de ejecucion

Modo `calendly_api`:

1. El VPS llama `/api/cron/reminders` cada 5 minutos.
2. El sistema consulta Calendly API por próximas citas.
3. El sistema cruza cada email contra Google Sheet.
4. Guarda/actualiza la cita en `whatsapp_appointments`.
5. Marca como canceladas las citas futuras de Calendly que ya no aparecen activas en la API.
6. El motor envia recordatorios cuando corresponda.

Modo `calendly` por webhook:

1. Calendly recibe una reserva.
2. Calendly llama a `/api/webhooks/calendly`.
3. El sistema guarda/actualiza la cita en `whatsapp_appointments`.
4. El VPS sigue llamando `/api/cron/reminders`.
5. El motor lee citas elegibles desde la base y envia WhatsApp segun las reglas actuales.

Modo `hybrid`:

1. Sincroniza Google Calendar.
2. Acepta citas de Calendly en la misma tabla.
3. Deduplica por identidad del paciente y hora de cita.
4. Prefiere Calendly cuando existe una cita equivalente en ambas fuentes.

## Reprogramaciones

En modo `calendly_api`, una reprogramacion puede hacer que la cita anterior desaparezca de los eventos activos de Calendly y aparezca una cita nueva con otro `appointment_id`.

Para evitar recordatorios del horario viejo, cada sincronizacion de Calendly API marca como canceladas las citas futuras de fuente `calendly` que ya no aparecen en la respuesta activa de Calendly:

```text
calendar_status=cancelled
eligibility_status=cancelled
skip_reason=calendly_api_missing_from_active_events
```

En modo webhook, cuando llega `invitee.canceled`, la cita se marca como cancelada con:

```text
skip_reason=appointment_cancelled
```

## Cancelaciones

Cuando llega `invitee.canceled`, la cita se marca como:

- `calendar_status=cancelled`
- `eligibility_status=cancelled`
- `skip_reason=appointment_cancelled`

Las citas canceladas no son elegibles para envío.

## Tablas principales

- `whatsapp_appointments`: citas normalizadas desde Google/Calendly.
- `whatsapp_reminder_state`: registra si ya se envio recordatorio del dia o de una hora.
- `whatsapp_message_log`: auditoria de envios, errores, skips e inelegibles.
- `whatsapp_daily_usage`: contador diario de mensajes.
- `whatsapp_monthly_usage`: contador mensual y alerta de umbral.
- `whatsapp_inbound_audit`: auditoria del modo inbound `GLOBAL_MODE=reminders`.

## Reglas de envio

Recordatorio del dia:

- Se envia si la cita es hoy en la zona configurada.
- Se evalua desde `DAY_REMINDER_HOUR`.
- Solo se envia una vez por `appointment_id`.

Recordatorio cercano:

- Se envia cuando la cita cae dentro de la ventana `HOUR_REMINDER_LEAD_MINUTES` + `HOUR_REMINDER_WINDOW_MINUTES`.
- Con la configuracion usual, entra cuando faltan unos 60 minutos y el VPS corre dentro de la ventana de 5 minutos.
- Solo se envia una vez por `appointment_id`.

El motor no envia si:

- la cita esta cancelada,
- la cita no tiene paciente elegible,
- ya se envio ese tipo de recordatorio,
- `REMINDERS_ENABLED=false`,
- `REMINDERS_DRY_RUN=true`,
- se alcanzo `MAX_MESSAGES_PER_RUN`,
- se alcanzo `MAX_MESSAGES_PER_DAY`,
- se alcanzo `MONTHLY_MESSAGE_LIMIT`.

## Dry-run

`REMINDERS_DRY_RUN=true` ejecuta el flujo real sin mandar WhatsApp:

1. sincroniza Calendly o Google segun `APPOINTMENT_SOURCE`,
2. actualiza/cancela citas locales segun corresponda,
3. calcula recordatorios elegibles,
4. devuelve `skipped` con `reason=dry_run` solo en la respuesta,
5. no llama a Meta WhatsApp,
6. no marca `day_sent_at` ni `hour_sent_at`.
7. no escribe filas en `whatsapp_message_log`.

Para una prueba puntual sin cambiar variables en Vercel, usa el secreto real del VPS o una variable local confirmada:

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://feliz-horizonte-bot.vercel.app/api/cron/reminders?dry_run=true"
```

Respuesta esperada si hay recordatorios elegibles:

```json
{
  "ok": true,
  "dryRun": true,
  "checked": { "day": 1, "hour": 0 },
  "sent": [],
  "failed": [],
  "skipped": [
    {
      "id": "calendly:event:invitee",
      "type": "day",
      "reason": "dry_run"
    }
  ]
}
```

## VPS

El VPS solo dispara el cron. No contiene la logica de recordatorios.

Importante para pruebas y futuras automatizaciones:

- La fuente de verdad del disparador es el VPS, no Vercel Cron ni GitHub Actions.
- Vercel compila y aloja el endpoint, pero no inicia el recordatorio por si solo.
- Para probar el flujo real, usa el script del VPS o el mismo secreto que usa ese script.
- No asumas que `.env` local contiene `CRON_SECRET`; puede no existir o no coincidir con produccion.
- Si una prueba local devuelve `401 Unauthorized`, revisa primero el secreto del VPS antes de depurar el modulo.

Datos documentados:

```text
host: 178.128.177.145
usuario: root
timer: feliz-horizonte-reminders.timer
service: feliz-horizonte-reminders.service
script: /usr/local/bin/feliz-horizonte-reminders.sh
nota: /opt/feliz-horizonte-reminders/README.txt
```

Comandos utiles:

```bash
systemctl status feliz-horizonte-reminders.timer
systemctl status feliz-horizonte-reminders.service
journalctl -u feliz-horizonte-reminders.service -n 50 --no-pager
systemctl start feliz-horizonte-reminders.service
```

El script debe apuntar al bot integrado:

```text
https://feliz-horizonte-bot.vercel.app/api/cron/reminders
```

Si apunta a `feliz-horizonte-reminders.vercel.app`, esta usando el servicio separado antiguo.

## Verificacion rapida

Resumen operativo:

```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://feliz-horizonte-bot.vercel.app/api/admin/summary
```

Cron manual:

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  https://feliz-horizonte-bot.vercel.app/api/cron/reminders
```

Dry-run manual desde el VPS, sin exponer el secreto:

```bash
SECRET=$(sed -n 's/.*Authorization: Bearer \([^"]*\).*/\1/p' /usr/local/bin/feliz-horizonte-reminders.sh)
curl -H "Authorization: Bearer ${SECRET}" \
  "https://feliz-horizonte-bot.vercel.app/api/cron/reminders?dry_run=true"
```

En el VPS:

```bash
systemctl start feliz-horizonte-reminders.service
journalctl -u feliz-horizonte-reminders.service -n 30 --no-pager
```

Respuesta esperada:

```json
{
  "ok": true,
  "checked": { "day": 0, "hour": 0 },
  "sent": [],
  "failed": [],
  "skipped": []
}
```
