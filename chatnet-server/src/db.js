// src/db.js — Pool de conexiones MySQL + setup inicial de tablas
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit:    10,
  charset: 'utf8mb4',
});

pool.getConnection()
  .then(conn => { conn.release(); console.log('[DB] Conectado a MySQL'); })
  .catch(err => { console.error('[DB] Error conectando a MySQL:', err.message); process.exit(1); });

async function setupTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      username   VARCHAR(32)  UNIQUE NOT NULL,
      email      VARCHAR(255) UNIQUE NOT NULL,
      password   VARCHAR(255) NOT NULL,
      tag        VARCHAR(6)   NOT NULL DEFAULT '0001',
      role       ENUM('user','admin') NOT NULL DEFAULT 'user',
      created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(64) UNIQUE NOT NULL,
      description TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    INSERT IGNORE INTO channels (name, description) VALUES
      ('general',    'Chat principal, todos son bienvenidos'),
      ('tecnologia', 'Habla de código, tools y devs'),
      ('off-topic',  'Cualquier cosa'),
      ('proyectos',  'Comparte lo que estás construyendo');
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      channel_id INT  NOT NULL,
      user_id    INT,
      username   VARCHAR(32) NOT NULL,
      content    TEXT        NOT NULL,
      reply_to   INT         DEFAULT NULL,
      edited_at  DATETIME    DEFAULT NULL,
      deleted    TINYINT(1)  DEFAULT 0,
      created_at DATETIME    DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL,
      FOREIGN KEY (reply_to)   REFERENCES messages(id) ON DELETE SET NULL,
      INDEX idx_channel_time (channel_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migración segura: añadir columnas si la tabla ya existe sin ellas
  const alterCols = [
    `ALTER TABLE messages ADD COLUMN reply_to  INT      DEFAULT NULL`,
    `ALTER TABLE messages ADD COLUMN edited_at DATETIME DEFAULT NULL`,
    `ALTER TABLE messages ADD COLUMN deleted   TINYINT(1) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user'`,
    `ALTER TABLE users ADD COLUMN description VARCHAR(300) DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN avatar_url  VARCHAR(512) DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN banner_url  VARCHAR(512) DEFAULT NULL`,
  ];
  for (const sql of alterCols) {
    try { await pool.query(sql); } catch (_) { /* columna ya existe, ignorar */ }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reactions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT         NOT NULL,
      user_id    INT         NOT NULL,
      emoji      VARCHAR(16) NOT NULL,
      UNIQUE KEY uniq_reaction (message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      channel_id   INT          NOT NULL,
      user_id      INT,
      username     VARCHAR(32)  NOT NULL,
      filename     VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type    VARCHAR(128) NOT NULL,
      size         INT          NOT NULL,
      created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // DM tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user1_id   INT NOT NULL,
      user2_id   INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_conv (user1_id, user2_id),
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_messages (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      sender_id       INT NOT NULL,
      content         TEXT NOT NULL,
      edited_at       DATETIME DEFAULT NULL,
      deleted         TINYINT(1) DEFAULT 0,
      read_at         DATETIME DEFAULT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log('[DB] Tablas listas');
}

module.exports = { pool, setupTables };
