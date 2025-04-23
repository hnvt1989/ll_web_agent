# Use the official Node.js image as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy the rest of the UI application code
COPY . .

# Expose the port the UI development server runs on (e.g., 5173 for Vite)
EXPOSE 5173

# Set the host to 0.0.0.0 to allow external connections to the dev server
ENV HOST=0.0.0.0

# Command to run the UI application in development mode
# Adjust if your start script is different (e.g., npm start)
# The -- --host is often needed for Vite/CRA dev servers inside Docker
CMD [ "npm", "run", "dev", "--", "--host" ] 