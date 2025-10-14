FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema para Baileys
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

# Crear directorio para sesiones
RUN mkdir -p /app/sessions

EXPOSE 3000

CMD ["node", "src/server.js"]