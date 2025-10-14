const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp API',
      version: '1.0.0',
      description: 'API para gestionar instancias de WhatsApp con Baileys',
      contact: {
        name: 'API Support',
        email: 'support@tudominio.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor de desarrollo'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key para autenticación'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              example: 'Mensaje de error'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            }
          }
        },
        Instance: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              example: 'cliente_salon_maria'
            },
            client_name: {
              type: 'string',
              example: 'Salón María'
            },
            phone_number: {
              type: 'string',
              example: '5491112345678'
            },
            status: {
              type: 'string',
              enum: ['connecting', 'connected', 'disconnected'],
              example: 'connected'
            },
            qr_code: {
              type: 'string',
              nullable: true,
              example: 'data:image/png;base64,...'
            },
            webhook_url: {
              type: 'string',
              example: 'https://tu-fastapi.com/webhook/whatsapp'
            }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ]
  },
  apis: ['./src/server.js'] // Ruta donde están los comentarios de Swagger
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;