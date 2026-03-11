// src/channels.js
const express         = require('express');
const { pool }        = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description FROM channels ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error('[channels/list]', err);
    res.status(500).json({ error: 'Error cargando canales' });
  }
});

router.get('/:id/messages', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id);
  if (isNaN(channelId)) return res.status(400).json({ error: 'ID inválido' });
  const userId = req.user.id;

  try {
    // Últimos 50 mensajes (incluyendo eliminados para mantener hilo de replies)
    const [msgs] = await pool.query(`
      SELECT
        m.id, m.user_id, m.username, m.content,
        m.reply_to, m.edited_at, m.deleted, m.created_at,
        r.username  AS reply_username,
        r.content   AS reply_content,
        u.role      AS user_role
      FROM messages m
      LEFT JOIN messages r ON r.id = m.reply_to
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel_id = ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [channelId]);

    if (msgs.length === 0) return res.json([]);

    const msgIds = msgs.map(m => m.id);

    const [reactions] = await pool.query(`
      SELECT message_id, emoji, COUNT(*) AS count, SUM(user_id=?) > 0 AS mine
      FROM reactions WHERE message_id IN (?)
      GROUP BY message_id, emoji
    `, [userId, msgIds]);

    const rxMap = {};
    for (const r of reactions) {
      if (!rxMap[r.message_id]) rxMap[r.message_id] = [];
      rxMap[r.message_id].push({
        emoji: r.emoji, count: r.count,
        mine: r.mine === 1 || r.mine === true
      });
    }

    const result = msgs.reverse().map(m => ({
      id:         m.id,
      user_id:    m.user_id,
      username:   m.username,
      role:       m.user_role || 'user',
      content:    m.content,
      edited_at:  m.edited_at,
      deleted:    m.deleted,
      reply_to:   m.reply_to,
      reply_snippet: m.reply_to ? {
        id:       m.reply_to,
        username: m.reply_username,
        content:  (m.reply_content || '').slice(0, 100)
      } : null,
      created_at: m.created_at,
      reactions:  rxMap[m.id] || []
    }));

    res.json(result);

  } catch (err) {
    console.error('[channels/messages]', err);
    res.status(500).json({ error: 'Error cargando mensajes' });
  }
});

// ── POST /api/channels — crear canal (solo admin) ────────────────
const { requireAdmin } = require('./auth');

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_\-áéíóúñ]/gi, '_').slice(0, 32);
  try {
    const [r] = await pool.query(
      'INSERT INTO channels (name, description) VALUES (?, ?)',
      [safeName, (description || '').trim().slice(0, 120)]
    );
    res.json({ id: r.insertId, name: safeName, description: (description || '').trim() });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un canal con ese nombre' });
    console.error('[channels/create]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── DELETE /api/channels/:id — eliminar canal (solo admin) ───────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await pool.query('DELETE FROM messages WHERE channel_id=?', [id]);
    await pool.query('DELETE FROM channels WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
