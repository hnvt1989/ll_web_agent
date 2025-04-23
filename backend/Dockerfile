# Use the official Node.js image as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package.json package-lock.json* ./

# Install dependencies (including dev dependencies needed for tsx/typescript)
# We switch from 'npm ci' to 'npm install' to allow adding tsx later
RUN npm install

# Copy the rest of the backend application code
COPY . .

# Install tsx to run TypeScript directly
RUN npm install --save-dev tsx

# Expose the port the backend runs on (e.g., 3000)
# This should match the port your server listens on in server.ts
EXPOSE 3000

# Command to run the backend application using tsx (shell form)
# Assumes your main entry point is src/server.ts
CMD npx tsx watch src/server.ts # Using watch for development HMR 