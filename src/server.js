require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { initDatabase } = require('./database');
const { createInstance, sendMessage, getInstanceStatus, deleteInstance, updateWebhook } = require('./whatsapp');
const { pool } = require('./database');
const { restoreInstances } = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "WhatsApp API Documentation"
}));

// Middleware de autenticación
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
 *     description: Verifica que la API esté funcionando
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
 * /api/instance/create:
 *   post:
 *     summary: Crear nueva instancia de WhatsApp
 *     description: Crea una nueva instancia de WhatsApp para un cliente
 *     tags: [Instances]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - instanceId
 *               - clientName
 *             properties:
 *               instanceId:
 *                 type: string
 *                 example: cliente_salon_maria
 *                 description: ID único para la instancia
 *               clientName:
 *                 type: string
 *                 example: Salón María
 *                 description: Nombre del cliente
 *               webhookUrl:
 *                 type: string
 *                 example: https://tu-fastapi.com/webhook/whatsapp
 *                 description: URL del webhook (opcional)
 *               webhookToken:
 *                 type: string
 *                 example: token_secreto_123
 *                 description: Token de seguridad del webhook (opcional)
 *     responses:
 *       200:
 *         description: Instancia creada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 instanceId:
 *                   type: string
 *                   example: cliente_salon_maria
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *       500:
 *         description: Error del servidor
 */
app.post('/api/instance/create', authMiddleware, async (req, res) => {
  try {
    const { instanceId, clientName, webhookUrl, webhookToken } = req.body;
    
    if (!instanceId || !clientName) {
      return res.status(400).json({ error: 'instanceId and clientName required' });
    }

    const result = await createInstance(instanceId, clientName, webhookUrl, webhookToken);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/instance/{instanceId}/status:
 *   get:
 *     summary: Obtener estado de instancia
 *     description: Obtiene el estado actual de una instancia incluyendo QR code si está disponible
 *     tags: [Instances]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la instancia
 *         example: cliente_salon_maria
 *     responses:
 *       200:
 *         description: Estado de la instancia
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Instance'
 *       404:
 *         description: Instancia no encontrada
 *       401:
 *         description: No autorizado
 */
app.get('/api/instance/:instanceId/status', authMiddleware, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const status = await getInstanceStatus(instanceId);
    
    if (!status) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/instance/{instanceId}/webhook:
 *   put:
 *     summary: Actualizar webhook de instancia
 *     description: Actualiza la URL del webhook para una instancia existente
 *     tags: [Instances]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         example: cliente_salon_maria
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - webhookUrl
 *             properties:
 *               webhookUrl:
 *                 type: string
 *                 example: https://tu-fastapi.com/webhook/whatsapp
 *               webhookToken:
 *                 type: string
 *                 example: token_secreto_123
 *     responses:
 *       200:
 *         description: Webhook actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autorizado
 */
app.put('/api/instance/:instanceId/webhook', authMiddleware, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { webhookUrl, webhookToken } = req.body;
    
    if (!webhookUrl) {
      return res.status(400).json({ error: 'webhookUrl required' });
    }

    const result = await updateWebhook(instanceId, webhookUrl, webhookToken);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/message/send:
 *   post:
 *     summary: Enviar mensaje de WhatsApp
 *     description: Envía un mensaje de texto o con imagen a un número de WhatsApp
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
 *               - instanceId
 *               - phone
 *               - text
 *             properties:
 *               instanceId:
 *                 type: string
 *                 example: cliente_salon_maria
 *                 description: ID de la instancia
 *               phone:
 *                 type: string
 *                 example: "5491112345678"
 *                 description: Número de teléfono (con código de país, sin +)
 *               text:
 *                 type: string
 *                 example: Hola! Tu cita está confirmada para mañana a las 3pm
 *                 description: Texto del mensaje
 *               base64Image:
 *                 type: string
 *                 example: data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...
 *                 description: Imagen en base64 (opcional)
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
 *                   example: 3EB0C0F4B2F6E5D8A1B4
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autorizado
 *       500:
 *         description: Error al enviar mensaje
 */
app.post('/api/message/send', authMiddleware, async (req, res) => {
  try {
    const { instanceId, phone, text, base64Image } = req.body;
    
    if (!instanceId || !phone || !text) {
      return res.status(400).json({ error: 'instanceId, phone, and text required' });
    }

    const result = await sendMessage(instanceId, phone, text, base64Image);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/instance/{instanceId}:
 *   delete:
 *     summary: Eliminar instancia
 *     description: Elimina una instancia de WhatsApp y cierra la sesión
 *     tags: [Instances]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         example: cliente_salon_maria
 *     responses:
 *       200:
 *         description: Instancia eliminada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         description: No autorizado
 *       500:
 *         description: Error al eliminar
 */
app.delete('/api/instance/:instanceId', authMiddleware, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await deleteInstance(instanceId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/webhook/logs/{instanceId}:
 *   get:
 *     summary: Ver logs de webhooks
 *     description: Obtiene los últimos 50 logs de webhooks de una instancia
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         example: cliente_salon_maria
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
 *                   instance_id:
 *                     type: string
 *                   webhook_url:
 *                     type: string
 *                   status_code:
 *                     type: integer
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: No autorizado
 */
app.get('/api/webhook/logs/:instanceId', authMiddleware, async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    const [logs] = await pool.query(
      'SELECT * FROM webhook_logs WHERE instance_id = ? ORDER BY timestamp DESC LIMIT 50',
      [instanceId]
    );
    
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/instances:
 *   get:
 *     summary: Listar todas las instancias
 *     description: Obtiene una lista de todas las instancias creadas
 *     tags: [Instances]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Lista de instancias
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Instance'
 *       401:
 *         description: No autorizado
 */
app.get('/api/instances', authMiddleware, async (req, res) => {
  try {
    const [instances] = await pool.query('SELECT * FROM instances ORDER BY created_at DESC');
    res.json(instances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
async function start() {
  await initDatabase();

  await restoreInstances();
  
  app.listen(PORT, () => {
    console.log(`🚀 WhatsApp API running on port ${PORT}`);
    console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
  });
}

start().catch(console.error);