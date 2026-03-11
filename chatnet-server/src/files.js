// src/files.js — Subida y gestión de archivos
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { pool } = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const router  = express.Router();
const UPLOADS = path.join(__dirname, '..', 'uploads');

// Crear carpeta si no existe
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ── Multer config ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});

const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
  'video/mp4','video/webm','video/ogg',
  'application/pdf',
  'text/plain','text/csv',
  'application/zip','application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
  }
});

// ── POST /api/files/upload ────────────────────────────────────────
router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: 'El archivo supera el límite de 50 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const { channelId } = req.body;
    if (!channelId) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Falta el channelId' });
    }

    try {
      const [result] = await pool.query(
        `INSERT INTO files (channel_id, user_id, username, filename, original_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          parseInt(channelId),
          req.user.id,
          req.user.username,
          req.file.filename,
          req.file.originalname,
          req.file.mimetype,
          req.file.size
        ]
      );

      res.json({
        ok: true,
        file: {
          id:            result.insertId,
          filename:      req.file.filename,
          original_name: req.file.originalname,
          mime_type:     req.file.mimetype,
          size:          req.file.size,
          url:           `/uploads/${req.file.filename}`,
          username:      req.user.username,
          channel_id:    parseInt(channelId),
          created_at:    new Date()
        }
      });
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      console.error('[files/upload]', e);
      res.status(500).json({ error: 'Error al guardar el archivo' });
    }
  });
});

// ── GET /api/files?channel=:id ────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { channel, limit = 50, offset = 0 } = req.query;
  try {
    const where = channel ? 'WHERE f.channel_id = ?' : '';
    const params = channel ? [parseInt(channel), parseInt(limit), parseInt(offset)] : [parseInt(limit), parseInt(offset)];
    const [rows] = await pool.query(`
      SELECT f.id, f.filename, f.original_name, f.mime_type, f.size,
             f.username, f.channel_id, f.created_at,
             c.name AS channel_name
      FROM files f
      JOIN channels c ON c.id = f.channel_id
      ${where}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `, params);
    res.json(rows.map(r => ({ ...r, url: `/uploads/${r.filename}` })));
  } catch (e) {
    console.error('[files/list]', e);
    res.status(500).json({ error: 'Error al listar archivos' });
  }
});

// ── DELETE /api/files/:id ─────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM files WHERE id=?', [req.params.id]);
    const file = rows[0];
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Solo el dueño o admin puede eliminar
    if (file.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Sin permiso' });

    await pool.query('DELETE FROM files WHERE id=?', [req.params.id]);
    const filePath = path.join(UPLOADS, file.filename);
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});

    res.json({ ok: true });
  } catch (e) {
    console.error('[files/delete]', e);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

module.exports = router;
