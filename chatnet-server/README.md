# ChatNet

Red social de mensajería en tiempo real construida con Node.js, Express, Socket.io y MySQL. Incluye canales públicos, mensajes directos, reacciones, menciones, subida de archivos y panel de administración.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Tiempo real | Socket.io |
| Base de datos | MySQL |
| Autenticación | JWT (7 días) + bcryptjs |
| Frontend | HTML + CSS + JS vanilla |

---

## Estructura

```
chatnet-server/
├── src/
│   ├── index.js        ← punto de entrada, rutas estáticas, Socket.io
│   ├── db.js           ← pool MySQL + creación automática de tablas
│   ├── auth.js         ← registro, login, JWT, perfil, avatares, admin
│   ├── channels.js     ← REST canales + historial de mensajes
│   ├── socket.js       ← lógica Socket.io en tiempo real
│   ├── files.js        ← subida, listado y borrado de archivos
│   ├── dm.js           ← mensajes directos (DMs)
│   └── themes.js       ← manifest dinámico de temas
├── public/
│   ├── index.html      ← app completa (frontend SPA)
│   └── tweakcn/        ← sistema de temas CSS + loader.js
├── profilePhotos/      ← avatares y banners de usuario
│   └── banners/
├── uploads/            ← archivos subidos en canales
├── .env.example
└── package.json
```

---

## Instalación

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/tu-usuario/chatnet-server.git
cd chatnet-server
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus datos:

```env
PORT=9090
DB_HOST=localhost
DB_PORT=3306
DB_NAME=chatnet
DB_USER=tu_usuario
DB_PASS=tu_contraseña
JWT_SECRET=cadena-larga-y-aleatoria
CLIENT_ORIGIN=http://tu-ip-o-dominio
```

### 3. Crear base de datos

```sql
CREATE DATABASE chatnet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> Las tablas se crean automáticamente al arrancar el servidor por primera vez.

### 4. Crear directorios de uploads

```bash
mkdir -p profilePhotos/banners uploads
```

### 5. Arrancar

```bash
# Producción
npm start

# Desarrollo con auto-reload
npm run dev
```

Accede en `http://localhost:9090`

---

## Integración con proxy (opcional)

Si usas un router Express con `http-proxy-middleware`, puedes exponer ChatNet en `/chat` sin mostrar el puerto:

**routes.json**
```json
{
  "/chat": { "type": "proxy", "port": 9090, "noRewrite": true }
}
```

**router.js**
```javascript
pathRewrite: config.noRewrite ? undefined : { [`^${route}`]: "/" },
```

La app detecta automáticamente si está corriendo bajo `/chat` y ajusta todas las rutas de API e imágenes.

---

## API REST

### Auth

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Crear cuenta |
| POST | `/api/auth/login` | No | Login → JWT |
| GET | `/api/auth/me` | JWT | Datos frescos del usuario |
| PATCH | `/api/auth/profile` | JWT | Editar nombre y descripción |
| POST | `/api/auth/avatar` | JWT | Subir foto de perfil (máx 5MB) |
| DELETE | `/api/auth/avatar` | JWT | Eliminar foto de perfil |
| GET | `/api/auth/profile/:username` | JWT | Perfil público de un usuario |
| POST | `/api/auth/promote` | JWT + Admin | Promover usuario a admin |
| POST | `/api/auth/demote` | JWT + Admin | Quitar rol admin |
| GET | `/api/auth/users` | JWT + Admin | Listar todos los usuarios |
| POST | `/api/auth/admin-reset-pwd` | JWT + Admin | Resetear contraseña de usuario |

### Canales

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/channels` | JWT | Lista de canales |
| POST | `/api/channels` | JWT + Admin | Crear canal |
| DELETE | `/api/channels/:id` | JWT + Admin | Eliminar canal |
| GET | `/api/channels/:id/messages` | JWT | Historial (últimos 50 mensajes) |

### Mensajes directos (DMs)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/dm` | JWT | Lista de conversaciones |
| POST | `/api/dm/open` | JWT | Abrir o crear conversación |
| GET | `/api/dm/:convId` | JWT | Historial de mensajes |
| POST | `/api/dm/:convId` | JWT | Enviar mensaje |

### Archivos

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/files/upload` | JWT | Subir archivo (máx 50MB) |
| GET | `/api/files?channel=:id` | JWT | Listar archivos del canal |
| DELETE | `/api/files/:id` | JWT | Eliminar archivo |

---

## Eventos Socket.io

### Cliente → Servidor

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `join_channel` | `channelId` | Unirse a un canal |
| `send_message` | `{ channelId, content, replyTo? }` | Enviar mensaje |
| `edit_message` | `{ messageId, content }` | Editar mensaje propio |
| `delete_message` | `{ messageId }` | Eliminar mensaje |
| `toggle_reaction` | `{ messageId, emoji }` | Poner/quitar reacción |
| `admin_clear_reactions` | `{ messageId }` | Limpiar todas las reacciones (admin) |
| `typing_start` | `{ channelId }` | Indicador "escribiendo..." |
| `typing_stop` | `{ channelId }` | Detener indicador |

### Servidor → Cliente

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `new_message` | mensaje completo con `channel_id` y `role` | Nuevo mensaje |
| `message_edited` | `{ messageId, content }` | Mensaje editado |
| `message_deleted` | `{ messageId }` | Mensaje eliminado |
| `reactions_updated` | `{ messageId, reactions }` | Reacciones actualizadas |
| `online_users` | `[{ username, tag, channelId }]` | Usuarios online en el canal |
| `user_typing` | `{ username }` | Alguien está escribiendo |
| `user_stop_typing` | `{ username }` | Alguien dejó de escribir |

---

## Base de datos

Las tablas se crean automáticamente al iniciar el servidor. Esquema:

```sql
users            (id, username, email, password, tag, role, description, avatar_url, banner_url, created_at)
channels         (id, name, description, created_at)
messages         (id, channel_id, user_id, username, content, reply_to, edited_at, deleted, created_at)
reactions        (id, message_id, user_id, emoji)  -- UNIQUE(message_id, user_id, emoji)
files            (id, channel_id, user_id, username, filename, original_name, mime_type, size, created_at)
dm_conversations (id, user1_id, user2_id, created_at)
dm_messages      (id, conversation_id, sender_id, content, edited_at, deleted, read_at, created_at)
```

---

## Features

- 💬 Canales públicos con historial
- 📨 Mensajes directos (DMs) entre usuarios
- ↩️ Responder mensajes con snippet de contexto
- ✏️ Editar y eliminar mensajes propios
- 😄 Reacciones con emoji picker
- @ Menciones con autocomplete y notificación visual
- \# Canales con autocomplete y navegación directa
- 🖼️ Subida de imágenes, videos y archivos
- 👤 Perfil con avatar, banner y descripción
- 🎨 Múltiples temas de color
- 🔴 Badge de mensajes no leídos por canal
- 🟢 Lista de usuarios online por canal en tiempo real
- ⚙️ Panel de administración (crear/eliminar canales, gestión de usuarios, reset de contraseñas)
- 📱 Diseño responsive para móvil

---

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `PORT` | Puerto del servidor | No (default: 9090) |
| `DB_HOST` | Host MySQL | Sí |
| `DB_PORT` | Puerto MySQL | No (default: 3306) |
| `DB_NAME` | Nombre de la base de datos | Sí |
| `DB_USER` | Usuario MySQL | Sí |
| `DB_PASS` | Contraseña MySQL | Sí |
| `JWT_SECRET` | Clave secreta para JWT | Sí |
| `CLIENT_ORIGIN` | Origen permitido en CORS | No (default: *) |

---

## .gitignore recomendado

```
node_modules/
.env
uploads/
profilePhotos/
*.log
```

---