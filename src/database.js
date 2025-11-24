const mysql = require('mysql2/promise');

// Pool para message_logs (local)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Pool para whatsapp_instancias (external)
const poolInstancias = mysql.createPool({
  host: process.env.DB_INSTANCIAS_HOST || 'localhost',
  port: process.env.DB_INSTANCIAS_PORT || 3306,
  user: process.env.DB_INSTANCIAS_USER,
  password: process.env.DB_INSTANCIAS_PASSWORD,
  database: process.env.DB_INSTANCIAS_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Verificar conexiones
async function initDatabase() {
  try {
    // Verificar conexion local (message_logs)
    const conn1 = await pool.getConnection();
    conn1.release();
    console.log('Database connection (message_logs): OK');

    // Verificar conexion externa (whatsapp_instancias)
    const conn2 = await poolInstancias.getConnection();
    conn2.release();
    console.log('Database connection (whatsapp_instancias): OK');

  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

module.exports = { pool, poolInstancias, initDatabase };
