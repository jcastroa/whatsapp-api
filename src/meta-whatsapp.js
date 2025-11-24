const { poolInstancias } = require('./database');
const FormData = require('form-data');

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0';
const META_API_BASE_URL = process.env.META_API_BASE_URL || 'https://graph.facebook.com';

/**
 * Obtiene la instancia de WhatsApp desde la base de datos
 * @param {string} phoneNumberId - El phone_number_id de la instancia
 * @returns {Promise<Object>} Datos de la instancia incluyendo access_token
 */
async function getInstance(phoneNumberId) {
  const [rows] = await poolInstancias.query(
    `SELECT id, negocio_id, waba_id, phone_number_id, business_account_id,
            access_token, token_expira_en, display_phone_number, phone_number,
            verified_name, quality_rating, waba_name, estado
     FROM whatsapp_instancias
     WHERE phone_number_id = ? AND estado = 'activo'`,
    [phoneNumberId]
  );

  if (rows.length === 0) {
    throw new Error(`Instance not found or inactive for phone_number_id: ${phoneNumberId}`);
  }

  const instance = rows[0];

  // Verificar si el token está expirado
  if (instance.token_expira_en && new Date(instance.token_expira_en) < new Date()) {
    throw new Error(`Access token expired for instance: ${phoneNumberId}`);
  }

  return instance;
}

/**
 * Sube un archivo de media a Meta para obtener el media_id
 * @param {string} phoneNumberId - El phone_number_id de la instancia
 * @param {string} accessToken - El token de acceso
 * @param {Buffer} fileBuffer - El buffer del archivo
 * @param {string} mimeType - El tipo MIME del archivo
 * @returns {Promise<string>} El media_id
 */
async function uploadMedia(phoneNumberId, accessToken, fileBuffer, mimeType) {
  const url = `${META_API_BASE_URL}/${META_API_VERSION}/${phoneNumberId}/media`;

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', fileBuffer, {
    filename: `file.${mimeType.split('/')[1]}`,
    contentType: mimeType
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      ...formData.getHeaders()
    },
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to upload media: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.id;
}

/**
 * Envía un mensaje de texto via la API de Meta
 * @param {string} phoneNumberId - El phone_number_id de la instancia
 * @param {string} accessToken - El token de acceso
 * @param {string} to - Número de teléfono destino
 * @param {string} text - Texto del mensaje
 * @returns {Promise<Object>} Respuesta de la API
 */
async function sendTextMessage(phoneNumberId, accessToken, to, text) {
  const url = `${META_API_BASE_URL}/${META_API_VERSION}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: { body: text }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to send text message: ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Envía una imagen via la API de Meta
 * @param {string} phoneNumberId - El phone_number_id de la instancia
 * @param {string} accessToken - El token de acceso
 * @param {string} to - Número de teléfono destino
 * @param {Object} imageData - Datos de la imagen {link?, id?, caption?}
 * @returns {Promise<Object>} Respuesta de la API
 */
async function sendImageMessage(phoneNumberId, accessToken, to, imageData) {
  const url = `${META_API_BASE_URL}/${META_API_VERSION}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'image',
    image: {}
  };

  if (imageData.id) {
    body.image.id = imageData.id;
  } else if (imageData.link) {
    body.image.link = imageData.link;
  }

  if (imageData.caption) {
    body.image.caption = imageData.caption;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to send image message: ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Envía un mensaje (texto o imagen) usando la API de Meta WhatsApp Business
 * @param {string} phoneNumberId - El phone_number_id (instancia)
 * @param {string} to - Número de teléfono destino (con código de país)
 * @param {Object} message - Objeto con el mensaje {text?, imageUrl?, base64Image?, caption?}
 * @returns {Promise<Object>} Respuesta con messageId
 */
async function sendMessage(phoneNumberId, to, message) {
  // Obtener la instancia y el token de la base de datos
  const instance = await getInstance(phoneNumberId);
  const accessToken = instance.access_token;

  let result;

  // Determinar el tipo de mensaje
  if (message.base64Image) {
    // Convertir base64 a buffer y subir a Meta
    let base64Data = message.base64Image;
    let mimeType = 'image/jpeg';

    // Extraer el tipo MIME si viene en formato data URL
    if (base64Data.includes(',')) {
      const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      } else {
        base64Data = base64Data.split(',')[1];
      }
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const mediaId = await uploadMedia(phoneNumberId, accessToken, buffer, mimeType);

    result = await sendImageMessage(phoneNumberId, accessToken, to, {
      id: mediaId,
      caption: message.caption || message.text
    });
  } else if (message.imageUrl) {
    // Enviar imagen por URL directamente
    result = await sendImageMessage(phoneNumberId, accessToken, to, {
      link: message.imageUrl,
      caption: message.caption || message.text
    });
  } else if (message.text) {
    // Enviar mensaje de texto
    result = await sendTextMessage(phoneNumberId, accessToken, to, message.text);
  } else {
    throw new Error('Message must contain text, imageUrl, or base64Image');
  }

  return {
    success: true,
    messageId: result.messages?.[0]?.id,
    response: result
  };
}

module.exports = {
  getInstance,
  sendMessage,
  uploadMedia
};
