require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { initDatabase, pool } = require('./database');
const { sendMessage } = require('./meta-whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "WhatsApp Meta API Documentation"
}));

// Middleware de autenticacion
function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API Key' });
  }

  next();
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Verifica que la API este funcionando
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: API funcionando correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

/**
 * @swagger
 * /api/message/send:
 *   post:
 *     summary: Enviar mensaje de WhatsApp
 *     description: |
 *       Envia un mensaje de texto o imagen via la API de Meta WhatsApp Business.
 *
 *       La instancia (phone_number_id) se usa para buscar el access_token en la base de datos.
 *
 *       **Tipos de mensaje soportados:**
 *       - Texto simple
 *       - Imagen por URL (debe ser accesible publicamente)
 *       - Imagen en base64 (se sube automaticamente a Meta)
 *     tags: [Messages]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - instance
 *               - phone
 *             properties:
 *               instance:
 *                 type: string
 *                 example: "941109455742800"
 *                 description: phone_number_id de la instancia de WhatsApp Business
 *               phone:
 *                 type: string
 *                 example: "51969558720"
 *                 description: Numero de telefono destino (con codigo de pais, sin +)
 *               text:
 *                 type: string
 *                 example: "Hola, gracias por escribir."
 *                 description: Texto del mensaje (requerido si no hay imagen)
 *               imageUrl:
 *                 type: string
 *                 example: "https://example.com/image.jpg"
 *                 description: URL de imagen publica (opcional, alternativa a base64Image)
 *               base64Image:
 *                 type: string
 *                 example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
 *                 description: Imagen en base64 (opcional, alternativa a imageUrl)
 *               caption:
 *                 type: string
 *                 example: "Descripcion de la imagen"
 *                 description: Caption para la imagen (opcional)
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 messageId:
 *                   type: string
 *                   example: "wamid.HBgLNTE5Njk1NTg3MjAVAgARGBI1QjM2RjU2QjM2..."
 *       400:
 *         description: Datos invalidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Instancia no encontrada
 *       500:
 *         description: Error al enviar mensaje
 */
app.post('/api/message/send', authMiddleware, async (req, res) => {
  try {
    const { instance, phone, text, imageUrl, base64Image, caption } = req.body;

    if (!instance || !phone) {
      return res.status(400).json({ error: 'instance and phone are required' });
    }

    if (!text && !imageUrl && !base64Image) {
      return res.status(400).json({ error: 'At least one of text, imageUrl, or base64Image is required' });
    }

    const message = {
      text,
      imageUrl,
      base64Image,
      caption
    };

    const result = await sendMessage(instance, phone, message);

    // Log the message
    try {
      await pool.query(
        `INSERT INTO message_logs (phone_number_id, to_number, message_type, message_id, status, request_payload, response_payload)
         VALUES (?, ?, ?, ?, 'sent', ?, ?)`,
        [
          instance,
          phone,
          imageUrl || base64Image ? 'image' : 'text',
          result.messageId,
          JSON.stringify({ text, imageUrl, caption, hasBase64: !!base64Image }),
          JSON.stringify(result.response)
        ]
      );
    } catch (logError) {
      console.error('Error logging message:', logError);
    }

    res.json({
      success: true,
      messageId: result.messageId
    });
  } catch (error) {
    // Log the error
    try {
      const { instance, phone, text, imageUrl, base64Image, caption } = req.body;
      await pool.query(
        `INSERT INTO message_logs (phone_number_id, to_number, message_type, status, request_payload, error)
         VALUES (?, ?, ?, 'failed', ?, ?)`,
        [
          instance || 'unknown',
          phone || 'unknown',
          imageUrl || base64Image ? 'image' : 'text',
          JSON.stringify({ text, imageUrl, caption, hasBase64: !!base64Image }),
          error.message
        ]
      );
    } catch (logError) {
      console.error('Error logging failure:', logError);
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.includes('expired')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/instance/{phoneNumberId}/status:
 *   get:
 *     summary: Obtener estado de instancia
 *     description: Obtiene el estado de una instancia de WhatsApp Business
 *     tags: [Instances]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: phoneNumberId
 *         required: true
 *         schema:
 *           type: string
 *         description: phone_number_id de la instancia
 *         example: "941109455742800"
 *     responses:
 *       200:
 *         description: Estado de la instancia
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 phone_number_id:
 *                   type: string
 *                 display_phone_number:
 *                   type: string
 *                 verified_name:
 *                   type: string
 *                 quality_rating:
 *                   type: string
 *                 estado:
 *                   type: string
 *                 token_expires:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Instancia no encontrada
 *       401:
 *         description: No autorizado
 */
app.get('/api/instance/:phoneNumberId/status', authMiddleware, async (req, res) => {
  try {
    const { phoneNumberId } = req.params;

    const [rows] = await pool.query(
      `SELECT phone_number_id, display_phone_number, phone_number, verified_name,
              quality_rating, waba_name, estado, token_expira_en, fecha_creacion
       FROM whatsapp_instancias
       WHERE phone_number_id = ?`,
      [phoneNumberId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    const instance = rows[0];
    res.json({
      phone_number_id: instance.phone_number_id,
      display_phone_number: instance.display_phone_number,
      phone_number: instance.phone_number,
      verified_name: instance.verified_name,
      quality_rating: instance.quality_rating,
      waba_name: instance.waba_name,
      estado: instance.estado,
      token_expires: instance.token_expira_en,
      created_at: instance.fecha_creacion
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/message/logs/{phoneNumberId}:
 *   get:
 *     summary: Ver logs de mensajes
 *     description: Obtiene los ultimos 50 logs de mensajes enviados de una instancia
 *     tags: [Messages]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: phoneNumberId
 *         required: true
 *         schema:
 *           type: string
 *         example: "941109455742800"
 *     responses:
 *       200:
 *         description: Lista de logs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   phone_number_id:
 *                     type: string
 *                   to_number:
 *                     type: string
 *                   message_type:
 *                     type: string
 *                   message_id:
 *                     type: string
 *                   status:
 *                     type: string
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: No autorizado
 */
app.get('/api/message/logs/:phoneNumberId', authMiddleware, async (req, res) => {
  try {
    const { phoneNumberId } = req.params;

    const [logs] = await pool.query(
      'SELECT id, phone_number_id, to_number, message_type, message_id, status, error, timestamp FROM message_logs WHERE phone_number_id = ? ORDER BY timestamp DESC LIMIT 50',
      [phoneNumberId]
    );

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
async function start() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`WhatsApp Meta API running on port ${PORT}`);
    console.log(`API Docs: http://localhost:${PORT}/api-docs`);
  });
}

start().catch(console.error);
