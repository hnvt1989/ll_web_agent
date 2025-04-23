# Stage 1: Base image with Node.js
FROM node:18-alpine AS base
WORKDIR /app

# Stage 2: Install backend production dependencies
FROM base AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
# Using '*' for package-lock.json handles cases where it might not exist initially
RUN npm ci --only=production

# Stage 3: Build backend application
FROM base AS backend-builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/ ./
# Ensure the build script is defined in backend/package.json
RUN npm run build
# Assuming build output is in /app/backend/dist

# Stage 4: Build UI application
FROM base AS ui-builder
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci
COPY ui/ ./
# Ensure the build script is defined in ui/package.json
RUN npm run build
# Assuming build output is in /app/ui/dist

# Stage 5: Final runtime image
FROM node:18-alpine AS runtime
WORKDIR /app

# Install 'serve' globally to host static UI files
RUN npm install -g serve

# Copy backend production dependencies from the specific stage
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules

# Copy backend built code from the builder stage
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Copy UI static files from the builder stage
COPY --from=ui-builder /app/ui/dist ./ui-static

# Copy the entrypoint script and make it executable
COPY entrypoint.sh .
RUN chmod +x ./entrypoint.sh

# Expose ports: 3000 for Backend API, 8080 for UI served by 'serve'
EXPOSE 3000
EXPOSE 8080

# Set the entrypoint script to run when the container starts
ENTRYPOINT ["./entrypoint.sh"] 