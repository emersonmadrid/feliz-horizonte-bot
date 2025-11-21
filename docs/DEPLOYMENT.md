# 🚀 Guía de Deployment

## Requisitos Previos

- [ ] Cuenta de Vercel
- [ ] Cuenta de Supabase
- [ ] WhatsApp Business API configurada
- [ ] Bot de Telegram creado
- [ ] API Key de Google Gemini

## 1. Configurar Supabase

### Crear las tablas necesarias

```sql
-- Tabla para mapeo de topics
CREATE TABLE fh_topics (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  topic_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas rápidas
CREATE INDEX idx_fh_topics_phone ON fh_topics(phone);
CREATE INDEX idx_fh_topics_topic_id ON fh_topics(topic_id);

-- Tabla para registro de mensajes
CREATE TABLE mensajes (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  mensaje TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas por chat
CREATE INDEX idx_mensajes_chat_id ON mensajes(chat_id);
CREATE INDEX idx_mensajes_created_at ON mensajes(created_at DESC);
```

## 2. Configurar Telegram

### Crear el bot

1. Hablar con [@BotFather](https://t.me/BotFather)
2. Ejecutar `/newbot`
3. Guardar el token generado

### Configurar el grupo

1. Crear un grupo en Telegram
2. Convertirlo en "Forum" (Supergrupo con temas)
3. Agregar el bot como administrador
4. Dar permisos de:
   - Enviar mensajes
   - Gestionar temas
   - Eliminar mensajes

### Obtener IDs

```bash
# Obtener tu chat ID (envía un mensaje al bot y ejecuta):
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"

# Obtener el ID del grupo (envía un mensaje en el grupo y ejecuta):
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

## 3. Configurar WhatsApp Business API

### Obtener credenciales

1. Ir a [Meta for Developers](https://developers.facebook.com/)
2. Crear una app de WhatsApp Business
3. Configurar el número de teléfono
4. Obtener:
   - `WHATSAPP_API_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`

### Configurar webhook (temporal)

Antes del deploy, usar ngrok para desarrollo:

```bash
ngrok http 3000
```

Luego configurar en Meta:
- URL: `https://tu-url.ngrok.io/webhook/whatsapp`
- Verify Token: El que definas en `.env`

## 4. Configurar Gemini AI

1. Ir a [Google AI Studio](https://aistudio.google.com/)
2. Crear un proyecto
3. Generar API Key
4. Copiar el token que empieza con `AIza...`

## 5. Deploy a Vercel

### Opción A: Deploy desde CLI

```bash
# Instalar Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### Opción B: Deploy desde GitHub

1. Conectar tu repo a Vercel
2. Configurar las variables de entorno
3. Deploy automático en cada push

### Configurar variables de entorno en Vercel

En el dashboard de Vercel, agregar:

```env
TELEGRAM_BOT_TOKEN=tu_token
TELEGRAM_ADMIN_CHAT_ID=tu_chat_id
TELEGRAM_GROUP_CHAT_ID=id_grupo
WHATSAPP_API_TOKEN=tu_token
WHATSAPP_PHONE_NUMBER_ID=tu_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=tu_token
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://...
SUPABASE_KEY=tu_key
PUBLIC_URL=https://tu-proyecto.vercel.app
VERCEL=1
VERCEL_ENV=production
ADMIN_SETUP_KEY=clave_secreta_admin
CALENDLY_THERAPY_URL=https://calendly.com/...
```

## 6. Configurar webhooks finales

### WhatsApp

Una vez deployado, actualizar el webhook en Meta:

```bash
curl -X POST "https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/webhooks" \
  -H "Authorization: Bearer <TOKEN>" \
  -d "url=https://tu-proyecto.vercel.app/webhook/whatsapp" \
  -d "verify_token=TU_TOKEN"
```

### Telegram

El bot se auto-configura en producción, pero puedes verificar:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## 7. Verificación

### Health check

```bash
curl https://tu-proyecto.vercel.app/
```

Respuesta esperada:
```json
{
  "status": "✅ FH WhatsApp Bot activo",
  "mode": "webhook",
  "env": "production"
}
```

### Listar topics

```bash
curl "https://tu-proyecto.vercel.app/admin/list-topics?admin_key=TU_ADMIN_KEY"
```

### Probar el bot

1. Enviar un mensaje a tu número de WhatsApp Business
2. Verificar que el bot responda
3. Verificar que aparezca en el panel de Telegram

## 8. Mantenimiento

### Limpiar topics antiguos

```bash
curl -X POST https://tu-proyecto.vercel.app/admin/clean-topic \
  -H "Content-Type: application/json" \
  -d '{
    "admin_key": "TU_ADMIN_KEY",
    "phone": "51999999999"
  }'
```

### Monitorear logs

En Vercel Dashboard > Tu Proyecto > Logs

### Backup de base de datos

En Supabase Dashboard > Database > Backups

## Troubleshooting

### Webhook no recibe mensajes

1. Verificar URL en Meta Developer Console
2. Verificar que `PUBLIC_URL` sea correcto
3. Revisar logs en Vercel

### Bot no crea topics

1. Verificar que el grupo sea un Forum
2. Verificar permisos del bot
3. Revisar tabla `fh_topics` en Supabase

### IA no responde

1. Verificar API key de Gemini
2. Revisar logs de error
3. Verificar cuota de API

### Timeout de funciones

Vercel tiene límite de 10s en plan gratuito. Considerar:
- Optimizar consultas a Supabase
- Reducir llamadas a IA
- Upgrade a plan Pro

## Rollback

Si algo sale mal:

```bash
# Listar deployments
vercel list

# Promover deployment anterior
vercel promote <deployment-url>
```

## Monitoring recomendado

- [ ] Configurar alertas en Vercel
- [ ] Monitorear uso de API de Gemini
- [ ] Revisar logs diariamente
- [ ] Hacer backup semanal de Supabase