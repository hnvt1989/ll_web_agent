# Use the official Node.js image as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Add a build argument to force a rebuild (helps avoid cache issues)
ARG REBUILD_ARG=unknown

# Copy package.json and package-lock.json (if available)
COPY package.json package-lock.json* ./

# Install dependencies including Anthropic SDK
RUN npm install && npm install @anthropic-ai/sdk --force

# Copy the rest of the backend application code
COPY . .

# Install tsx to run TypeScript directly if it's not already in the dependencies
RUN npm install --save-dev tsx

# Display installed packages for debugging
RUN npm list @anthropic-ai/sdk

# Expose the port the backend runs on
EXPOSE 3000

# Command to run the backend application
CMD npx tsx watch src/server.ts 