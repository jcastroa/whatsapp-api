const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp Meta API',
      version: '2.0.0',
      description: 'API para enviar mensajes via WhatsApp Business Cloud API de Meta',
      contact: {
        name: 'API Support',
        email: 'support@tudominio.com'
      }
    },
    servers: [
      {
        url: 'https://whatsapp.cita247.com',
        description: 'Servidor de produccion'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key para autenticacion'
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
            phone_number_id: {
              type: 'string',
              example: '941109455742800'
            },
            display_phone_number: {
              type: 'string',
              example: '+51 969 558 720'
            },
            verified_name: {
              type: 'string',
              example: 'Mi Negocio'
            },
            quality_rating: {
              type: 'string',
              example: 'GREEN'
            },
            estado: {
              type: 'string',
              enum: ['activo', 'inactivo', 'suspendido', 'desvinculado'],
              example: 'activo'
            },
            token_expires: {
              type: 'string',
              format: 'date-time',
              example: '2024-02-15T00:00:00.000Z'
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
  apis: ['./src/server.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;