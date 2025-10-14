const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
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
    // Tabla de instancias de WhatsApp
    await connection.query(`
      CREATE TABLE IF NOT EXISTS instances (
        id VARCHAR(255) PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20),
        webhook_url VARCHAR(500),
        webhook_token VARCHAR(255),
        status ENUM('connecting', 'connected', 'disconnected') DEFAULT 'connecting',
        qr_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created (created_at)
      )
    `);

    // Tabla de mensajes
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        instance_id VARCHAR(255),
        from_number VARCHAR(20),
        to_number VARCHAR(20),
        message_text TEXT,
        message_type VARCHAR(50) DEFAULT 'text',
        message_id VARCHAR(255),
        webhook_sent BOOLEAN DEFAULT FALSE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE,
        INDEX idx_instance (instance_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_message_id (message_id),
        INDEX idx_webhook_sent (webhook_sent)
      )
    `);

    // Tabla de logs de webhooks (para debugging)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        instance_id VARCHAR(255),
        webhook_url VARCHAR(500),
        payload JSON,
        status_code INT,
        response TEXT,
        error TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_instance (instance_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_status (status_code)
      )
    `);

    console.log('✅ Database initialized');
    console.log('📊 Tables created: instances, messages, webhook_logs');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, initDatabase };