// src/auth.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { pool } = require('./db');

// ── Avatar upload config ───────────────────────────────────────────
const AVATARS  = path.join(__dirname, '..', 'profilePhotos');
const BANNERS  = path.join(__dirname, '..', 'profilePhotos', 'banners');
if (!fs.existsSync(AVATARS)) fs.mkdirSync(AVATARS, { recursive: true });
if (!fs.existsSync(BANNERS)) fs.mkdirSync(BANNERS, { recursive: true });

const bannerStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, BANNERS),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `tmp-banner-${Date.now()}${ext}`);
  }
});
const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Solo se permiten imágenes'));
  }
});

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, AVATARS),
  filename: (_, file, cb) => {
    // Nombre temporal — se renombra tras verificar auth
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    // El username no está disponible aquí aún, usamos timestamp temporal
    cb(null, `tmp-${Date.now()}${ext}`);
  }
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Solo se permiten imágenes'));
  }
});

const router = express.Router();

// ── Token ──────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, tag: user.tag, role: user.role || 'user' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── POST /api/auth/register ────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  if (username.length < 3 || username.length > 32)
    return res.status(400).json({ error: 'El nombre debe tener entre 3 y 32 caracteres' });
  if (password.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const tag  = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');

    const [result] = await pool.query(
      `INSERT INTO users (username, email, password, tag) VALUES (?, ?, ?, ?)`,
      [username.trim(), email.toLowerCase().trim(), hash, tag]
    );

    const user = { id: result.insertId, username: username.trim(), tag, role: 'user' };
    res.json({ token: signToken(user), user: { id: user.id, username: user.username, tag: user.tag, role: user.role } });

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const field = err.message.includes('email') ? 'email' : 'username';
      return res.status(409).json({ error: `Ese ${field} ya está en uso` });
    }
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const payload = { id: user.id, username: user.username, tag: user.tag, role: user.role || 'user' };
    res.json({
      token: signToken(payload),
      user:  {
        id:          user.id,
        username:    user.username,
        tag:         user.tag,
        role:        user.role || 'user',
        description: user.description || '',
        avatar_url:  user.avatar_url || null
      }
    });

  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Middleware: JWT requerido ──────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ── Middleware: solo admins ────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  next();
}

// ── GET /api/auth/me ───────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, tag, role, description, avatar_url, banner_url FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user: rows[0] });
  } catch(e) {
    console.error('[auth/me]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/promote — promover usuario a admin ─────────────
// Solo admins pueden promover. El primer admin se setea desde la BD directamente:
// UPDATE users SET role='admin' WHERE username='tuusuario';
router.post('/promote', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Falta el username' });
  try {
    const [r] = await pool.query(
      "UPDATE users SET role='admin' WHERE username=?", [username]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, message: `${username} es ahora admin` });
  } catch (err) {
    console.error('[auth/promote]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/demote — quitar admin ──────────────────────────
router.post('/demote', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Falta el username' });
  if (username === req.user.username) return res.status(400).json({ error: 'No puedes quitarte admin a ti mismo' });
  try {
    await pool.query("UPDATE users SET role='user' WHERE username=?", [username]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/auth/users — listar todos (solo admin) ───────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, tag, role, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PATCH /api/auth/profile — editar propio perfil ────────────────
router.patch('/profile', requireAuth, async (req, res) => {
  const { username, description } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
  if (username.trim().length < 3 || username.trim().length > 32)
    return res.status(400).json({ error: 'El nombre debe tener entre 3 y 32 caracteres' });
  try {
    await pool.query(
      'UPDATE users SET username=?, description=? WHERE id=?',
      [username.trim(), (description||'').trim().slice(0, 300), req.user.id]
    );
    res.json({ ok: true, username: username.trim(), description: (description||'').trim() });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Ese nombre ya está en uso' });
    console.error('[auth/profile]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/avatar — subir foto de perfil ─────────────────
router.post('/avatar', requireAuth, (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err instanceof multer.MulterError)
      return res.status(413).json({ error: 'La imagen supera el límite de 5 MB' });
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });

    // Renombrar a nombre definitivo con user id
    const ext         = path.extname(req.file.filename);
    // Nombre final: username-timestamp.ext
    const ext2        = path.extname(req.file.filename);
    const ts          = Date.now();
    const safeUser    = req.user.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const finalName   = `${safeUser}-${ts}${ext2}`;
    const tmpPath     = req.file.path;
    const finalPath   = path.join(AVATARS, finalName);

    try {
      // Borrar avatar anterior si existe
      const [rows] = await pool.query('SELECT avatar_url FROM users WHERE id=?', [req.user.id]);
      const prevUrl = (rows[0]?.avatar_url || '').split('?')[0];
      if (prevUrl) {
        const prevPath = path.join(__dirname, '..', prevUrl.replace(/^\//, '').replace(/^profilePhotos/, 'profilePhotos'));
        const absPath  = path.join(__dirname, '..', 'profilePhotos', path.basename(prevUrl.split('?')[0]));
        if (fs.existsSync(absPath)) fs.unlink(absPath, () => {});
      }
      fs.renameSync(tmpPath, finalPath);
    } catch (_) {
      try { fs.renameSync(tmpPath, finalPath); } catch(e2) { console.error('[avatar rename]', e2); }
    }

    const avatarUrl = `/profilePhotos/${finalName}`;
    try {
      await pool.query('UPDATE users SET avatar_url=? WHERE id=?', [avatarUrl, req.user.id]);
      res.json({ ok: true, avatar_url: avatarUrl });
    } catch (e) {
      console.error('[auth/avatar]', e);
      res.status(500).json({ error: 'Error al guardar avatar' });
    }
  });
});

// ── DELETE /api/auth/avatar — eliminar foto de perfil ────────────
router.delete('/avatar', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT avatar_url FROM users WHERE id=?', [req.user.id]);
    const url = rows[0]?.avatar_url;
    if (url) {
      const p = path.join(__dirname, '..', url.replace(/^\//, ''));
      if (fs.existsSync(p)) fs.unlink(p, () => {});
      await pool.query('UPDATE users SET avatar_url=NULL WHERE id=?', [req.user.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/admin-reset-pwd — resetear contraseña (solo admin) ──
router.post('/admin-reset-pwd', requireAuth, requireAdmin, async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) return res.status(400).json({ error: 'Faltan datos' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const [r] = await pool.query('UPDATE users SET password=? WHERE username=?', [hash, username]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true });
  } catch(e) {
    console.error('[auth/admin-reset-pwd]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/auth/profile/:username — perfil público ─────────────
router.get('/profile/:username', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, tag, role, description, avatar_url, banner_url FROM users WHERE username=?',
      [req.params.username]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/banner — subir banner de perfil ───────────────
router.post('/banner', requireAuth, (req, res) => {
  bannerUpload.single('banner')(req, res, async (err) => {
    if (err instanceof multer.MulterError)
      return res.status(413).json({ error: 'La imagen supera el límite de 8 MB' });
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });

    const ext       = path.extname(req.file.filename);
    const safeUser  = req.user.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const finalName = `banner-${safeUser}-${Date.now()}${ext}`;
    const tmpPath   = req.file.path;
    const finalPath = path.join(BANNERS, finalName);

    try {
      const [rows] = await pool.query('SELECT banner_url FROM users WHERE id=?', [req.user.id]);
      const prev = (rows[0]?.banner_url || '').split('?')[0];
      if (prev) {
        const absPath = path.join(__dirname, '..', 'profilePhotos', 'banners', path.basename(prev));
        if (fs.existsSync(absPath)) fs.unlink(absPath, () => {});
      }
      fs.renameSync(tmpPath, finalPath);
    } catch(_) {
      try { fs.renameSync(tmpPath, finalPath); } catch(e2) {}
    }

    const bannerUrl = `/profilePhotos/banners/${finalName}`;
    try {
      await pool.query('UPDATE users SET banner_url=? WHERE id=?', [bannerUrl, req.user.id]);
      res.json({ ok: true, banner_url: bannerUrl });
    } catch(e) {
      res.status(500).json({ error: 'Error al guardar banner' });
    }
  });
});

// ── DELETE /api/auth/banner ───────────────────────────────────────
router.delete('/banner', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT banner_url FROM users WHERE id=?', [req.user.id]);
    const url = rows[0]?.banner_url;
    if (url) {
      const absPath = path.join(__dirname, '..', 'profilePhotos', 'banners', path.basename(url.split('?')[0]));
      if (fs.existsSync(absPath)) fs.unlink(absPath, () => {});
      await pool.query('UPDATE users SET banner_url=NULL WHERE id=?', [req.user.id]);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = { router, requireAuth, requireAdmin };