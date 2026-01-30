# Use official Node.js LTS image as the base
FROM node:20-alpine AS build

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# --- Production image ---
FROM node:20-alpine
WORKDIR /app

# Copy only necessary files for production
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# Set environment variables
ENV NODE_ENV=production

# Expose port (if needed, e.g., 3000)
# EXPOSE 3000

# Start the service
CMD ["node", "dist/index.js"]
