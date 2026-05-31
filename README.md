# 🤖 Feliz Horizonte WhatsApp Bot

Bot de atención al cliente inteligente para servicios de salud mental, integrado con WhatsApp Business API, Telegram y Google Gemini AI.

![Estado](https://img.shields.io/badge/Estado-Producción-success)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

## 🌟 Características

> Antes de modificar endpoints, recordatorios o flujos de producción, revisar `docs/PROJECT_MAP.md`.
> Ese documento resume la arquitectura real, qué ya existe y qué no conviene duplicar.

### 🧠 **IA Conversacional Avanzada**
- Respuestas contextuales usando Google Gemini 2.5 Flash
- Historial persistente de conversaciones en Supabase
- Detección automática de intenciones y servicios
- Manejo inteligente de transcripción y síntesis de audio

### 📱 **Integración Multi-canal**
- **WhatsApp Business API** con soporte de texto, audio y botones interactivos
- **Panel de Control en Telegram** con organización por temas (topics)
- Transición fluida entre IA y atención humana

### 🎯 **Gestión Inteligente de Conversaciones**
- Detección automática de emergencias psicológicas
- Sistema de priorización de casos
- Timeout automático con advertencias (15 min de inactividad)
- Historial persistente con límite configurable

### 🔒 **Seguridad y Moderación**
- Filtro de lenguaje ofensivo para agentes humanos
- Sanitización automática de prompts
- Validación de entradas y datos sensibles

### 🚀 **Arquitectura Escalable**
- Despliegue en Vercel con webhooks
- Estado de conversación en memoria + Supabase
- Modo desarrollo con polling (ngrok)
- Tests automatizados con Vitest

### 🗓️ **Recordatorios de citas**
- Fuente configurable: Google Calendar, Calendly o modo híbrido
- Webhook de Calendly para `invitee.created` e `invitee.canceled`
- Registro operativo en Postgres/Supabase para auditoría de envíos
- Límites de seguridad por ejecución, día y mes

## 📋 Requisitos Previos

- Node.js 18+
- Cuenta de [Vercel](https://vercel.com)
- Base de datos [Supabase](https://supabase.com)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- Bot de Telegram ([BotFather](https://t.me/BotFather))
- API Key de [Google Gemini](https://aistudio.google.com/)

## 🛠️ Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/emersonmadrid/feliz-horizonte-bot.git
cd feliz-horizonte-bot
npm install
```

### 2. Configurar variables de entorno

Crea un archivo `.env` basándote en el siguiente ejemplo:

```env
# Telegram
TELEGRAM_BOT_TOKEN=tu_token_de_botfather
TELEGRAM_ADMIN_CHAT_ID=tu_chat_id
TELEGRAM_GROUP_CHAT_ID=id_del_grupo_forum
TELEGRAM_TOPIC_ID_DEFAULT=0

# WhatsApp Business API
WHATSAPP_API_TOKEN=tu_token_de_meta
WHATSAPP_PHONE_NUMBER_ID=tu_phone_number_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=token_personalizado_para_webhook

# WhatsApp Features
WHATSAPP_AUDIO_TRANSCRIPTION=1  # 1=activado, 0=desactivado
WHATSAPP_AUDIO_RESPONSES=0      # 1=activado, 0=desactivado

# Google Gemini AI
GEMINI_API_KEY=AIza...

# Supabase
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu_anon_key

# Historial de conversación
CONVERSATION_HISTORY_TABLE=fh_conversation_history
CONVERSATION_HISTORY_MAX_MESSAGES=20

# Estado de conversación
CONVERSATION_STATE_TABLE=fh_conversation_state
CONVERSATION_TTL_MINUTES=720
CONVERSATION_STATE_CLEANUP_MINUTES=5

# Deployment
PUBLIC_URL=https://tu-proyecto.vercel.app
VERCEL=0  # 1 en producción
VERCEL_ENV=development  # production en producción

# Admin
ADMIN_SETUP_KEY=clave_secreta_para_endpoints_admin

# Calendly (opcional)
CALENDLY_THERAPY_URL=https://calendly.com/tu-link-terapia
CALENDLY_PSYCHIATRY_URL=https://calendly.com/tu-link-psiquiatria

# Recordatorios (opcional)
APPOINTMENT_SOURCE=google # google | calendly_api | calendly | hybrid
CALENDLY_API_TOKEN=token_api_para_polling
CALENDLY_WEBHOOK_SECRET=token_largo_para_webhook
CALENDLY_TIMEZONE=America/Lima
```

### 3. Configurar Supabase

Ejecuta el siguiente SQL en el editor de Supabase:

```sql
-- Tabla para mapeo de topics de Telegram
CREATE TABLE fh_topics (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  topic_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fh_topics_phone ON fh_topics(phone);
CREATE INDEX idx_fh_topics_topic_id ON fh_topics(topic_id);

-- Tabla para registro de mensajes (analytics)
CREATE TABLE mensajes (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  mensaje TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mensajes_chat_id ON mensajes(chat_id);
CREATE INDEX idx_mensajes_created_at ON mensajes(created_at DESC);

-- Tabla para historial de conversación
CREATE TABLE fh_conversation_history (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' o 'assistant'
  content TEXT NOT NULL,
  intent TEXT,
  service TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_history_phone ON fh_conversation_history(phone);
CREATE INDEX idx_history_created_at ON fh_conversation_history(created_at DESC);

-- Tabla para estado de conversación
CREATE TABLE fh_conversation_state (
  phone TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_state_updated_at ON fh_conversation_state(updated_at DESC);
```

### 4. Configurar Telegram

1. Crea un bot con [@BotFather](https://t.me/BotFather) usando `/newbot`
2. Crea un grupo y conviértelo en **Supergrupo con temas** (Forum)
3. Agrega el bot como **administrador** con permisos para:
   - Enviar mensajes
   - Gestionar temas
   - Eliminar mensajes

### 5. Desarrollo local

```bash
# Modo desarrollo (usa polling)
npm run dev

# Tests
npm test
```

Para webhooks locales, usa [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
# Luego configura el webhook en Meta Developer Console
```

## 🚀 Deployment a Vercel

### Opción A: CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

### Opción B: GitHub

1. Conecta tu repositorio a Vercel
2. Configura las variables de entorno en el dashboard
3. Deploy automático en cada push a `main`

### Configurar Webhook de WhatsApp

Una vez deployado:

```bash
curl -X POST "https://graph.facebook.com/v20.0/YOUR_PHONE_ID/webhooks" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "url=https://tu-proyecto.vercel.app/webhook/whatsapp" \
  -d "verify_token=TU_WEBHOOK_TOKEN"
```

## 📊 Endpoints de Admin

### Health Check

```bash
GET /health
```

Respuesta:
```json
{
  "ok": true,
  "mode": "webhook",
  "supabase": { "ok": true },
  "telegram": { "ok": true, "username": "tu_bot" }
}
```

### Listar Topics

```bash
GET /admin/list-topics?admin_key=TU_ADMIN_KEY
```

### Conversaciones Activas

```bash
GET /admin/active-conversations?admin_key=TU_ADMIN_KEY
```

### Métricas de Estado

```bash
GET /admin/state-metrics?admin_key=TU_ADMIN_KEY
```

### Reset de Conversación

```bash
POST /admin/reset-conversation
Content-Type: application/json

{
  "admin_key": "TU_ADMIN_KEY",
  "phone": "51999999999"
}
```

### Limpiar Topic

```bash
POST /admin/clean-topic
Content-Type: application/json

{
  "admin_key": "TU_ADMIN_KEY",
  "phone": "51999999999"
}
```

## 🎮 Comandos de Telegram

Desde el panel de control (grupo con temas):

- `/auto` - Devuelve el control a la IA para esta conversación
- `/estado` - Muestra el estado actual de la conversación
- `/modo [auto|manual|smart]` - Cambia el modo global (solo admin)
- `/enviar <número> | <mensaje>` - Envía mensaje directo (solo admin)

## 🔧 Arquitectura

```
├── src/
│   ├── app.js                     # Aplicación principal
│   ├── config/
│   │   └── business-info.js       # Información del negocio
│   ├── prompts/
│   │   ├── business-info.md       # Prompt base de la IA
│   │   ├── prompt-loader.js       # Cargador de prompts
│   │   └── system-prompt.js       # Prompt del sistema
│   ├── services/
│   │   ├── ai.service.js          # Integración con Gemini
│   │   ├── conversation-history.service.js  # Historial persistente
│   │   └── state.service.js       # Gestión de estado
│   └── utils/
│       ├── ai.utils.js            # Utilidades de IA
│       ├── health.utils.js        # Health checks
│       └── validators.js          # Validaciones
├── docs/
│   └── DEPLOYMENT.md              # Guía detallada de deployment
├── package.json
├── vercel.json
└── README.md
```

## 🧪 Testing

```bash
npm test
```

Tests incluidos:
- Sanitización de API keys
- Construcción de prompts
- Validadores de entrada
- Health checks

## 🔐 Seguridad

- ✅ Filtrado de lenguaje ofensivo
- ✅ Detección de emergencias
- ✅ Validación de números de teléfono
- ✅ Sanitización de API keys
- ✅ No almacena datos médicos sensibles por chat
- ✅ Endpoints de admin protegidos con clave

## 📈 Monitoreo

- Logs en tiempo real en Vercel Dashboard
- Métricas de conversaciones activas
- Tracking de intenciones y prioridades
- Estadísticas de historial por conversación

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agrega nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📝 Notas Importantes

### Limitaciones de Vercel Free Tier
- Timeout de 10 segundos en funciones serverless
- Si necesitas más tiempo, considera Vercel Pro

### Audio WhatsApp
- La transcripción y síntesis de audio están **desactivadas por defecto**
- Actívalas con las variables `WHATSAPP_AUDIO_*`
- Requieren créditos de Gemini AI adicionales

### Prompts Personalizados
- El prompt base está en `src/prompts/business-info.md`
- Puedes almacenarlo en Supabase Storage para actualizaciones sin redeploy
- Configura `SUPABASE_PROMPT_BUCKET` y `SUPABASE_PROMPT_PATH`

## 📄 Licencia

Este proyecto es privado y de uso exclusivo para Feliz Horizonte.

## 🆘 Soporte

Para reportar bugs o solicitar funcionalidades, abre un [Issue](https://github.com/emersonmadrid/feliz-horizonte-bot/issues).

---

Desarrollado con 💙 para **Feliz Horizonte** - Salud Mental en Perú
