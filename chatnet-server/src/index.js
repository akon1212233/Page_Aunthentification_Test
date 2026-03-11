// src/index.js — Punto de entrada
require('dotenv').config();

const express         = require('express');
const http            = require('http');
const { Server }      = require('socket.io');
const cors            = require('cors');
const path            = require('path');
const { setupTables } = require('./db');
const filesRouter    = require('./files');
const { router: authRouter } = require('./auth');
const channelsRouter  = require('./channels');
const themesRouter    = require('./themes');
const { setupSocket } = require('./socket');
const dmRouter        = require('./dm');

const app    = express();
const server = http.createServer(app);
// Socket.io responde en /socket.io (acceso directo) y en /chat/socket.io (via proxy sin rewrite)
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST'] }
});
// Alias para /chat/socket.io cuando viene del proxy sin pathRewrite
server.on('upgrade', (req, socket, head) => {
  if(req.url?.startsWith('/chat/socket.io')) {
    req.url = req.url.replace('/chat/socket.io', '/socket.io');
  }
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

// Archivos estáticos
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/profilePhotos', express.static(path.join(__dirname, '..', 'profilePhotos'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

// Ruta raíz → index.html
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// API REST
app.use('/api/auth',     authRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/themes',   themesRouter);
app.use('/api/files',    filesRouter);
app.use('/api/dm',       dmRouter);

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Socket.io
setupSocket(io);

const PORT = process.env.PORT || 3000;

setupTables()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n🚀 ChatNet corriendo en http://localhost:${PORT}`);
      console.log(`   Frontend → http://localhost:${PORT}`);
      console.log(`   API      → http://localhost:${PORT}/api`);
      console.log(`   Temas    → http://localhost:${PORT}/api/themes\n`);
    });
  })
  .catch(err => {
    console.error('Error en setup inicial:', err);
    process.exit(1);
  });