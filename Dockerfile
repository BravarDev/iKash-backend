# --- ETAPA DE COMPILACIÓN ---
FROM node:22-slim AS builder

WORKDIR /usr/src/app

# Copiar metadatos de dependencias
COPY package*.json ./
COPY tsconfig*.json nest-cli.json ./

# Instalar TODAS las dependencias
RUN npm ci

# Copiar esquema de Prisma y código fuente
COPY prisma ./prisma
COPY src ./src

# Generar cliente de Prisma y compilar NestJS
RUN npx prisma generate
RUN npm run build

# --- ETAPA DE PRODUCCIÓN ---
FROM node:22-slim AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY package*.json ./

# Instalar solo dependencias de producción de forma limpia
RUN npm ci --omit=dev

# Copiar la estructura de Prisma y el build compilado
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/dist ./dist

# 💡 SOLUCIÓN AQUÍ: Volver a generar el cliente dentro del node_modules limpio de producción
RUN npx prisma generate

# Cloud Run inyecta el puerto 8080 automáticamente
EXPOSE 8080

CMD ["node", "dist/src/main.js"]