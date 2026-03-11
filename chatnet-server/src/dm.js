// src/dm.js — Mensajes privados
const express         = require('express');
const { pool }        = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// ── GET /api/dm — listar conversaciones del usuario ──────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query(`
      SELECT
        c.id, c.user1_id, c.user2_id, c.created_at,
        u1.username AS user1_name, u1.avatar_url AS user1_av, u1.tag AS user1_tag,
        u2.username AS user2_name, u2.avatar_url AS user2_av, u2.tag AS user2_tag,
        (SELECT content FROM dm_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_msg,
        (SELECT created_at FROM dm_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=c.id AND sender_id!=? AND read_at IS NULL) AS unread
      FROM dm_conversations c
      JOIN users u1 ON u1.id = c.user1_id
      JOIN users u2 ON u2.id = c.user2_id
      WHERE c.user1_id=? OR c.user2_id=?
      ORDER BY last_at DESC
    `, [userId, userId, userId]);
    res.json(rows);
  } catch (e) {
    console.error('[dm/list]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/dm/open — abrir o crear conversación ───────────────
router.post('/open', requireAuth, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Falta username' });
  const me = req.user.id;
  try {
    const [uRows] = await pool.query('SELECT id, username, tag, avatar_url FROM users WHERE username=?', [username]);
    if (!uRows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    const other = uRows[0];
    if (other.id === me) return res.status(400).json({ error: 'No puedes chatear contigo mismo' });

    const u1 = Math.min(me, other.id), u2 = Math.max(me, other.id);
    const [existing] = await pool.query(
      'SELECT id FROM dm_conversations WHERE user1_id=? AND user2_id=?', [u1, u2]
    );
    let convId;
    if (existing[0]) {
      convId = existing[0].id;
    } else {
      const [r] = await pool.query(
        'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?,?)', [u1, u2]
      );
      convId = r.insertId;
    }
    res.json({ conversation_id: convId, other });
  } catch (e) {
    console.error('[dm/open]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/dm/:convId — historial de mensajes ──────────────────
router.get('/:convId', requireAuth, async (req, res) => {
  const convId = parseInt(req.params.convId);
  const userId = req.user.id;
  if (isNaN(convId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Verificar acceso
    const [conv] = await pool.query(
      'SELECT * FROM dm_conversations WHERE id=? AND (user1_id=? OR user2_id=?)',
      [convId, userId, userId]
    );
    if (!conv[0]) return res.status(403).json({ error: 'Sin acceso' });

    const [msgs] = await pool.query(`
      SELECT m.id, m.sender_id, m.content, m.created_at, m.edited_at, m.deleted, u.username, u.avatar_url
      FROM dm_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id=?
      ORDER BY m.created_at DESC LIMIT 50
    `, [convId]);

    // Marcar como leídos
    await pool.query(
      'UPDATE dm_messages SET read_at=NOW() WHERE conversation_id=? AND sender_id!=? AND read_at IS NULL',
      [convId, userId]
    );

    res.json(msgs.reverse());
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/dm/:convId — enviar mensaje ────────────────────────
router.post('/:convId', requireAuth, async (req, res) => {
  const convId = parseInt(req.params.convId);
  const userId = req.user.id;
  const { content } = req.body;
  if (isNaN(convId) || !content?.trim()) return res.status(400).json({ error: 'Datos inválidos' });
  try {
    const [conv] = await pool.query(
      'SELECT * FROM dm_conversations WHERE id=? AND (user1_id=? OR user2_id=?)',
      [convId, userId, userId]
    );
    if (!conv[0]) return res.status(403).json({ error: 'Sin acceso' });

    const [r] = await pool.query(
      'INSERT INTO dm_messages (conversation_id, sender_id, content) VALUES (?,?,?)',
      [convId, userId, content.trim().slice(0, 4000)]
    );
    res.json({ id: r.insertId, sender_id: userId, content: content.trim(), created_at: new Date() });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
