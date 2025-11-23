const mysql = require('mysql2/promise');

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

// Crear tablas si no existen
async function initDatabase() {
  const connection = await pool.getConnection();
  
  try {
    // Tabla de instancias de WhatsApp Business (Meta API)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_instancias (
        id INT(11) NOT NULL AUTO_INCREMENT,
        negocio_id INT(11) NOT NULL,
        waba_id VARCHAR(50) NOT NULL,
        phone_number_id VARCHAR(50) NOT NULL,
        business_account_id VARCHAR(50) NULL DEFAULT NULL,
        access_token TEXT NOT NULL,
        token_expira_en DATETIME NULL DEFAULT NULL,
        display_phone_number VARCHAR(30) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        verified_name VARCHAR(255) NULL DEFAULT NULL,
        quality_rating VARCHAR(20) NULL DEFAULT NULL,
        waba_name VARCHAR(255) NULL DEFAULT NULL,
        estado ENUM('activo','inactivo','suspendido','desvinculado') NULL DEFAULT 'activo',
        webhook_verificado TINYINT(1) NULL DEFAULT 0,
        fecha_creacion DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        fecha_desvinculacion DATETIME NULL DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE INDEX uk_negocio (negocio_id),
        UNIQUE INDEX uk_phone_number_id (phone_number_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Tabla de logs de mensajes enviados
    await connection.query(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone_number_id VARCHAR(50) NOT NULL,
        to_number VARCHAR(50) NOT NULL,
        message_type VARCHAR(50) DEFAULT 'text',
        message_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'sent',
        request_payload JSON,
        response_payload JSON,
        error TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_phone_number_id (phone_number_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_message_id (message_id)
      )
    `);

    console.log('Database initialized');
    console.log('Tables: whatsapp_instancias, message_logs');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, initDatabase };