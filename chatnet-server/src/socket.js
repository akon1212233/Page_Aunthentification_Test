// src/socket.js — Lógica de Socket.io
const jwt      = require('jsonwebtoken');
const { pool } = require('./db');

const online = new Map();

function setupSocket(io) {

  // ── Auth ─────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No autenticado'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const { id: userId, username, tag, role } = socket.user;
    const isAdmin = role === 'admin';
    console.log(`[Socket] + ${username}#${tag} (${socket.id})`);
    online.set(socket.id, { userId, username, tag, channelId: null });

    // ── join_channel ─────────────────────────────────────────────
    socket.on('join_channel', (channelId) => {
      channelId = parseInt(channelId);
      if (isNaN(channelId)) return;
      const entry = online.get(socket.id);
      const prev  = entry?.channelId;

      // 1. Actualizar canal en el mapa ANTES de hacer broadcast
      if (entry) entry.channelId = channelId;

      // 2. Notificar al canal anterior (el socket aún está en esa room)
      //    El broadcast excluye al socket actual, así que el que se va
      //    recibe la lista del canal nuevo, no la del anterior.
      if (prev && prev !== channelId) {
        broadcastOnline(io, prev);   // los del canal anterior ven que se fue
      }

      // 3. Mover el socket de room
      if (prev) socket.leave(`channel:${prev}`);
      socket.join(`channel:${channelId}`);

      // 4. Notificar al canal nuevo (incluye al que acaba de entrar)
      broadcastOnline(io, channelId);
    });

    // ── send_message ─────────────────────────────────────────────
    socket.on('send_message', async ({ channelId, content, replyTo }) => {
      channelId = parseInt(channelId);
      if (!channelId || !content?.trim()) return;

      const text    = content.trim().slice(0, 2000);
      const replyId = replyTo ? parseInt(replyTo) : null;

      try {
        // Si hay reply, traer snippet del mensaje original
        let replySnippet = null;
        if (replyId) {
          const [rRows] = await pool.query(
            'SELECT id, username, content FROM messages WHERE id=? AND deleted=0',
            [replyId]
          );
          if (rRows[0]) replySnippet = {
            id:       rRows[0].id,
            username: rRows[0].username,
            content:  rRows[0].content.slice(0, 100)
          };
        }

        const [result] = await pool.query(
          `INSERT INTO messages (channel_id, user_id, username, content, reply_to)
           VALUES (?, ?, ?, ?, ?)`,
          [channelId, userId, username, text, replyId]
        );

        const msg = {
          id:           result.insertId,
          channel_id:   channelId,
          user_id:      userId,
          username,
          role,
          content:      text,
          reply_to:     replyId,
          reply_snippet: replySnippet,
          edited_at:    null,
          created_at:   new Date(),
          reactions:    []
        };

        io.to(`channel:${channelId}`).emit('new_message', msg);

      } catch (err) {
        console.error('[socket/send_message]', err);
        socket.emit('error', { message: 'No se pudo enviar el mensaje' });
      }
    });

    // ── edit_message ─────────────────────────────────────────────
    socket.on('edit_message', async ({ messageId, content }) => {
      if (!messageId || !content?.trim()) return;
      const text = content.trim().slice(0, 2000);

      try {
        const [rows] = await pool.query(
          'SELECT channel_id, user_id FROM messages WHERE id=? AND deleted=0',
          [messageId]
        );
        const msg = rows[0];
        if (!msg) return;
        // Solo el autor o un admin puede editar
        if (msg.user_id !== userId && !isAdmin) return;

        await pool.query(
          'UPDATE messages SET content=?, edited_at=NOW() WHERE id=?',
          [text, messageId]
        );

        io.to(`channel:${msg.channel_id}`).emit('message_edited', {
          messageId,
          content:   text,
          edited_at: new Date(),
          by_admin:  isAdmin && msg.user_id !== userId
        });

      } catch (err) {
        console.error('[socket/edit_message]', err);
      }
    });

    // ── delete_message ───────────────────────────────────────────
    socket.on('delete_message', async ({ messageId }) => {
      if (!messageId) return;

      try {
        const [rows] = await pool.query(
          'SELECT channel_id, user_id FROM messages WHERE id=? AND deleted=0',
          [messageId]
        );
        const msg = rows[0];
        if (!msg) return;
        // Solo el autor o un admin puede eliminar
        if (msg.user_id !== userId && !isAdmin) return;

        await pool.query(
          'UPDATE messages SET deleted=1, content=? WHERE id=?',
          [isAdmin && msg.user_id !== userId ? '[eliminado por admin]' : '[mensaje eliminado]', messageId]
        );

        io.to(`channel:${msg.channel_id}`).emit('message_deleted', {
          messageId,
          by_admin: isAdmin && msg.user_id !== userId
        });

      } catch (err) {
        console.error('[socket/delete_message]', err);
      }
    });

    // ── admin_clear_reactions ────────────────────────────────────
    socket.on('admin_clear_reactions', async ({ messageId }) => {
      if (!isAdmin || !messageId) return;
      try {
        await pool.query('DELETE FROM reactions WHERE message_id=?', [messageId]);
        const [msgRows] = await pool.query('SELECT channel_id FROM messages WHERE id=?', [messageId]);
        const channelId = msgRows[0]?.channel_id;
        if (channelId) io.to(`channel:${channelId}`).emit('reactions_updated', { messageId, reactions: [] });
      } catch (err) {
        console.error('[socket/admin_clear_reactions]', err);
      }
    });

    // ── toggle_reaction ──────────────────────────────────────────
    socket.on('toggle_reaction', async ({ messageId, emoji }) => {
      if (!messageId || !emoji) return;

      try {
        const [del] = await pool.query(
          'DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?',
          [messageId, userId, emoji]
        );
        if (del.affectedRows === 0) {
          await pool.query(
            'INSERT IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)',
            [messageId, userId, emoji]
          );
        }

        const [rxRows] = await pool.query(`
          SELECT emoji, COUNT(*) AS count, SUM(user_id=?) > 0 AS mine
          FROM reactions WHERE message_id=? GROUP BY emoji
        `, [userId, messageId]);

        const reactions = rxRows.map(r => ({
          emoji: r.emoji, count: r.count,
          mine: r.mine === 1 || r.mine === true
        }));

        const [msgRows] = await pool.query(
          'SELECT channel_id FROM messages WHERE id=?', [messageId]
        );
        const channelId = msgRows[0]?.channel_id;
        if (!channelId) return;

        io.to(`channel:${channelId}`).emit('reactions_updated', { messageId, reactions });

      } catch (err) {
        console.error('[socket/toggle_reaction]', err);
      }
    });

    // ── typing ───────────────────────────────────────────────────
    socket.on('typing_start', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('user_typing', { username });
    });
    socket.on('typing_stop', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('user_stop_typing', { username });
    });

    // ── disconnect ───────────────────────────────────────────────
    socket.on('disconnect', () => {
      const data = online.get(socket.id);
      console.log(`[Socket] - ${data?.username}#${data?.tag} (${socket.id})`);
      if (data?.channelId) broadcastOnline(io, data.channelId);
      online.delete(socket.id);
    });
  });
}

function broadcastOnline(io, channelId) {
  const users = [];
  for (const [, data] of online) {
    if (data.channelId === channelId)
      users.push({ username: data.username, tag: data.tag });
  }
  io.to(`channel:${channelId}`).emit('online_users', users);
}

module.exports = { setupSocket };