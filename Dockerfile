# Use Node.js LTS image as base
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy the remaining project files
COPY . .

# Build the React + Vite frontend assets
RUN npm run build

# Expose port 3000 for the Express server
EXPOSE 3000

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application using tsx to run the TypeScript server
CMD ["npx", "tsx", "server.ts"]
