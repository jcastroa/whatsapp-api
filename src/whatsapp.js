const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const { pool } = require('./database');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Almacén en memoria de instancias activas
const instances = new Map();

/**
 * Crear nueva instancia de WhatsApp
 * @param {string} instanceId - ID único de la instancia
 * @param {string} clientName - Nombre del cliente
 * @param {string} webhookUrl - URL del webhook (opcional, puede ser el mismo para todos)
 * @param {string} webhookToken - Token de seguridad del webhook (opcional)
 */
async function createInstance(instanceId, clientName, webhookUrl = null, webhookToken = null, retryCount = 0) {
    try {
        console.log(`🔵 [${instanceId}] Starting instance creation (attempt ${retryCount + 1})...`);

        // Si ya existe, retornar error
        if (instances.has(instanceId)) {
            console.log(`🔴 [${instanceId}] Instance already exists in memory`);
            throw new Error('Instance already exists');
        }

        const sessionPath = `./sessions/${instanceId}`;
        console.log(`🔵 [${instanceId}] Session path: ${sessionPath}`);

        // Crear directorio de sesión si no existe
        if (!fs.existsSync(sessionPath)) {
            console.log(`🔵 [${instanceId}] Creating session directory...`);
            fs.mkdirSync(sessionPath, { recursive: true });
            console.log(`✅ [${instanceId}] Session directory created`);
        } else {
            console.log(`✅ [${instanceId}] Session directory already exists`);
        }

        console.log(`🔵 [${instanceId}] Loading auth state...`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        console.log(`✅ [${instanceId}] Auth state loaded`);

        console.log(`🔵 [${instanceId}] Creating WhatsApp socket...`);
        const sock = makeWASocket({
            auth: state,

            // Browser de DESKTOP (mejor compatibilidad + historial completo)
            browser: Browsers.macOS('Desktop'),  // ← Puede ser Windows o Ubuntu también

            // Sincronizar historial completo
            syncFullHistory: true,  // ← Recomendado para desktop

            // QR en terminal
            printQRInTerminal: true,

            // NO especificar version (dejar por defecto)
            // version: [...] ← NO AGREGAR ESTO

            // Timeouts recomendados
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,

            // Otras opciones útiles
            markOnlineOnConnect: false,
            getMessage: async () => undefined
        });
        console.log(`✅ [${instanceId}] WhatsApp socket created`);

        // Guardar en DB con webhook
        console.log(`🔵 [${instanceId}] Saving to database...`);
        await pool.query(
            `INSERT INTO instances (id, client_name, webhook_url, webhook_token, status) 
       VALUES (?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE 
       webhook_url = VALUES(webhook_url), 
       webhook_token = VALUES(webhook_token),
       status = VALUES(status)`,
            [instanceId, clientName, webhookUrl, webhookToken, 'connecting']
        );
        console.log(`✅ [${instanceId}] Saved to database`);

        // Event: Connection Update
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            console.log(`🔵 [${instanceId}] Connection update:`, {
                connection,
                hasQR: !!qr,
                lastDisconnectReason: lastDisconnect?.error?.output?.statusCode
            });

            if (qr) {
                try {
                    console.log(`🔵 [${instanceId}] QR STRING RECEIVED (length: ${qr.length})`);
                    console.log(`🔵 [${instanceId}] Generating QR code...`);

                    const qrCodeDataURL = await QRCode.toDataURL(qr);
                    console.log(`✅ [${instanceId}] QR code generated (length: ${qrCodeDataURL.length})`);

                    await pool.query(
                        'UPDATE instances SET qr_code = ?, status = ? WHERE id = ?',
                        [qrCodeDataURL, 'connecting', instanceId]
                    );
                    console.log(`✅ [${instanceId}] QR code saved to database`);

                    // Notificar via webhook
                    await sendWebhook(instanceId, {
                        event: 'qr_updated',
                        instanceId,
                        qrCode: qrCodeDataURL,
                        timestamp: new Date().toISOString()
                    });
                    console.log(`✅ [${instanceId}] QR webhook sent`);
                } catch (error) {
                    console.error(`🔴 [${instanceId}] Error generating QR:`, error);
                }
            }

            if (connection === 'open') {
                const phone = sock.user.id.split(':')[0];
                await pool.query(
                    'UPDATE instances SET status = ?, phone_number = ?, qr_code = NULL WHERE id = ?',
                    ['connected', phone, instanceId]
                );

                console.log(`✅ [${instanceId}] Connected with phone: ${phone}`);

                await sendWebhook(instanceId, {
                    event: 'connected',
                    instanceId,
                    phoneNumber: phone,
                    timestamp: new Date().toISOString()
                });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`🔴 [${instanceId}] Connection closed. Status code: ${statusCode}`);

                // CRÍTICO: Limpiar de memoria ANTES de cualquier cosa
                instances.delete(instanceId);

                // Manejar códigos de error específicos
                if (statusCode === 405) {
                    console.log(`⚠️  [${instanceId}] Error 405 - Version mismatch or rate limit`);

                    // Si es el primer intento, borrar sesión y reintentar
                    if (retryCount < 2) {
                        console.log(`🔄 [${instanceId}] Deleting session and retrying...`);

                        // Borrar sesión corrupta
                        if (fs.existsSync(sessionPath)) {
                            fs.rmSync(sessionPath, { recursive: true, force: true });
                        }

                        // Esperar más tiempo
                        setTimeout(() => {
                            createInstance(instanceId, clientName, webhookUrl, webhookToken, retryCount + 1)
                                .catch(err => console.error(`🔴 [${instanceId}] Retry failed:`, err.message));
                        }, 10000);  // 10 segundos

                        return;
                    }
                }

                if (shouldReconnect && retryCount < 5) {
                    console.log(`🔄 [${instanceId}] Reconnecting in 5 seconds (attempt ${retryCount + 1}/5)...`);
                    setTimeout(() => {
                        createInstance(instanceId, clientName, webhookUrl, webhookToken, retryCount + 1)
                            .catch(err => console.error(`🔴 [${instanceId}] Reconnection failed:`, err.message));
                    }, 5000);
                } else {
                    console.log(`❌ [${instanceId}] Max retries reached or logged out`);
                    await pool.query('UPDATE instances SET status = ?, qr_code = NULL WHERE id = ?', ['disconnected', instanceId]);

                    await sendWebhook(instanceId, {
                        event: 'disconnected',
                        instanceId,
                        reason: statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'failed',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // ========================================
        // EVENT: Mensajes entrantes
        // ========================================
        sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                // Ignorar mensajes propios
                if (msg.key.fromMe) continue;

                try {
                    const from = msg.key.remoteJid;
                    const messageId = msg.key.id;

                    // Extraer texto del mensaje según tipo
                    let text = '';
                    let messageType = 'text';
                    let mediaUrl = null;

                    if (msg.message?.conversation) {
                        text = msg.message.conversation;
                        messageType = 'text';
                    } else if (msg.message?.extendedTextMessage) {
                        text = msg.message.extendedTextMessage.text;
                        messageType = 'text';
                    } else if (msg.message?.imageMessage) {
                        text = msg.message.imageMessage.caption || '';
                        messageType = 'image';
                    } else if (msg.message?.videoMessage) {
                        text = msg.message.videoMessage.caption || '';
                        messageType = 'video';
                    } else if (msg.message?.audioMessage) {
                        messageType = 'audio';
                    } else if (msg.message?.documentMessage) {
                        text = msg.message.documentMessage.caption || '';
                        messageType = 'document';
                    }

                    // Guardar en DB
                    await pool.query(
                        `INSERT INTO messages (instance_id, from_number, message_text, message_type, message_id, webhook_sent) 
             VALUES (?, ?, ?, ?, ?, ?)`,
                        [instanceId, from, text, messageType, messageId, false]
                    );

                    console.log(`📩 Message received in ${instanceId} from ${from}: ${text.substring(0, 50)}...`);

                    // Obtener webhook de esta instancia
                    const [instanceData] = await pool.query(
                        'SELECT webhook_url, webhook_token FROM instances WHERE id = ?',
                        [instanceId]
                    );

                    if (instanceData[0]?.webhook_url) {
                        const webhookUrl = instanceData[0].webhook_url;
                        const webhookToken = instanceData[0].webhook_token;

                        // Payload completo para el webhook
                        const payload = {
                            event: 'message_received',
                            instanceId,
                            messageId,
                            from: from.replace('@s.whatsapp.net', ''),
                            text,
                            messageType,
                            timestamp: new Date().toISOString(),
                            pushName: msg.pushName || '',
                            isGroup: from.includes('@g.us'),
                            quoted: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ? true : false
                        };

                        // Enviar a webhook
                        const sent = await sendWebhook(instanceId, payload, webhookUrl, webhookToken);

                        // Marcar como enviado
                        if (sent) {
                            await pool.query(
                                'UPDATE messages SET webhook_sent = TRUE WHERE message_id = ?',
                                [messageId]
                            );
                        }
                    } else {
                        console.warn(`⚠️  No webhook configured for instance ${instanceId}`);
                    }

                } catch (error) {
                    console.error(`Error processing message for ${instanceId}:`, error);
                }
            }
        });


        // Guardar instancia en memoria
        instances.set(instanceId, sock);
        console.log(`✅ [${instanceId}] Instance saved to memory. Total instances: ${instances.size}`);

        return { success: true, instanceId };

    } catch (error) {
        console.error(`Error creating instance ${instanceId}:`, error);
        throw error;
    }
}

/**
 * Enviar webhook con retry logic
 * @param {string} instanceId - ID de la instancia
 * @param {object} payload - Datos a enviar
 * @param {string} webhookUrl - URL del webhook (opcional, se busca en DB si no se proporciona)
 * @param {string} webhookToken - Token del webhook (opcional)
 * @param {number} retries - Número de reintentos
 */
async function sendWebhook(instanceId, payload, webhookUrl = null, webhookToken = null, retries = 3) {
    try {
        // Si no se proporciona webhook, buscar en DB
        if (!webhookUrl) {
            const [instanceData] = await pool.query(
                'SELECT webhook_url, webhook_token FROM instances WHERE id = ?',
                [instanceId]
            );

            if (!instanceData[0]?.webhook_url) {
                console.warn(`No webhook URL found for instance ${instanceId}`);
                return false;
            }

            webhookUrl = instanceData[0].webhook_url;
            webhookToken = instanceData[0].webhook_token;
        }

        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-API/1.0'
        };

        // Agregar token si existe
        if (webhookToken) {
            headers['X-Webhook-Token'] = webhookToken;
        }

        // Reintentos con backoff exponencial
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await axios.post(webhookUrl, payload, {
                    headers,
                    timeout: 10000 // 10 segundos
                });

                // Log exitoso
                await pool.query(
                    `INSERT INTO webhook_logs (instance_id, webhook_url, payload, status_code, response) 
           VALUES (?, ?, ?, ?, ?)`,
                    [instanceId, webhookUrl, JSON.stringify(payload), response.status, JSON.stringify(response.data)]
                );

                console.log(`✅ Webhook sent successfully for ${instanceId} (attempt ${attempt})`);
                return true;

            } catch (error) {
                const statusCode = error.response?.status || 0;
                const errorMessage = error.message;

                console.error(`❌ Webhook error for ${instanceId} (attempt ${attempt}/${retries}): ${errorMessage}`);

                // Log de error
                await pool.query(
                    `INSERT INTO webhook_logs (instance_id, webhook_url, payload, status_code, error) 
           VALUES (?, ?, ?, ?, ?)`,
                    [instanceId, webhookUrl, JSON.stringify(payload), statusCode, errorMessage]
                );

                // Si es el último intento, fallar
                if (attempt === retries) {
                    return false;
                }

                // Esperar antes de reintentar (backoff exponencial: 1s, 2s, 4s)
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
            }
        }

    } catch (error) {
        console.error(`Error in sendWebhook for ${instanceId}:`, error);
        return false;
    }
}

/**
 * Enviar mensaje de WhatsApp
 * @param {string} instanceId - ID de la instancia
 * @param {string} phone - Número de teléfono
 * @param {string} text - Texto del mensaje
 * @param {string} base64Image - Imagen en base64 (opcional)
 */
async function sendMessage(instanceId, phone, text, base64Image = null) {
    try {
        const sock = instances.get(instanceId);

        if (!sock) {
            throw new Error(`Instance ${instanceId} not found or not connected`);
        }

        // Formatear JID (WhatsApp ID)
        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;

        let sentMsg;

        if (base64Image) {
            
            // Asegurarnos de quitar el encabezado si viene en formato data:image/jpeg;base64,...
            const base64Data = base64Image.split(',')[1] || base64Image;

            // Convertir a Buffer
            const buffer = Buffer.from(base64Data, 'base64');

            // Enviar imagen
            sentMsg = await sock.sendMessage(jid, {
                image: buffer,
                caption: text
            });
        } else {
            // Solo texto
            sentMsg = await sock.sendMessage(jid, { text });
        }

        // Guardar en DB
        await pool.query(
            `INSERT INTO messages (instance_id, to_number, message_text, message_type, message_id, webhook_sent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
            [instanceId, phone, text, mediaUrl ? 'image' : 'text', sentMsg.key.id, true]
        );

        console.log(`📤 Message sent from ${instanceId} to ${phone}`);

        return {
            success: true,
            messageId: sentMsg.key.id
        };

    } catch (error) {
        console.error(`Error sending message from ${instanceId}:`, error);
        throw error;
    }
}

/**
 * Actualizar webhook de una instancia
 * @param {string} instanceId - ID de la instancia
 * @param {string} webhookUrl - Nueva URL del webhook
 * @param {string} webhookToken - Nuevo token (opcional)
 */
async function updateWebhook(instanceId, webhookUrl, webhookToken = null) {
    try {
        await pool.query(
            'UPDATE instances SET webhook_url = ?, webhook_token = ? WHERE id = ?',
            [webhookUrl, webhookToken, instanceId]
        );

        console.log(`🔄 Webhook updated for ${instanceId}`);

        return { success: true };
    } catch (error) {
        console.error(`Error updating webhook for ${instanceId}:`, error);
        throw error;
    }
}

/**
 * Obtener estado de una instancia
 * @param {string} instanceId - ID de la instancia
 */
async function getInstanceStatus(instanceId) {
    try {
        const [rows] = await pool.query('SELECT * FROM instances WHERE id = ?', [instanceId]);

        if (rows.length === 0) {
            return null;
        }

        const instance = rows[0];

        // Agregar info de si está en memoria (activa)
        instance.is_active = instances.has(instanceId);

        return instance;
    } catch (error) {
        console.error(`Error getting status for ${instanceId}:`, error);
        throw error;
    }
}

/**
 * Eliminar instancia
 * @param {string} instanceId - ID de la instancia
 */
async function deleteInstance(instanceId) {
    try {
        const sock = instances.get(instanceId);

        // Cerrar sesión de WhatsApp
        if (sock) {
            try {
                await sock.logout();
            } catch (error) {
                console.warn(`Warning during logout of ${instanceId}:`, error.message);
            }
            instances.delete(instanceId);
        }

        // Eliminar archivos de sesión
        const sessionPath = `./sessions/${instanceId}`;
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        // Eliminar de DB (cascade eliminará mensajes y logs)
        await pool.query('DELETE FROM instances WHERE id = ?', [instanceId]);

        console.log(`🗑️  Instance ${instanceId} deleted`);

        return { success: true };
    } catch (error) {
        console.error(`Error deleting instance ${instanceId}:`, error);
        throw error;
    }
}

/**
 * Reiniciar todas las instancias al arrancar el servidor
 * (Para recuperar instancias después de reinicio del servidor)
 */
async function restoreInstances() {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM instances WHERE status = ?',
            ['connected']
        );

        console.log(`🔄 Restoring ${rows.length} connected instances...`);

        for (const instance of rows) {
            try {
                await createInstance(
                    instance.id,
                    instance.client_name,
                    instance.webhook_url,
                    instance.webhook_token
                );
            } catch (error) {
                console.error(`Failed to restore instance ${instance.id}:`, error.message);
            }
        }

        console.log(`✅ Instances restored`);
    } catch (error) {
        console.error('Error restoring instances:', error);
    }
}

module.exports = {
    createInstance,
    sendMessage,
    getInstanceStatus,
    deleteInstance,
    updateWebhook,
    restoreInstances
};