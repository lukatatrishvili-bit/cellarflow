FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl

# Set working directory inside the container
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy the remaining project files
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the frontend assets
RUN npm run build

# Ensure the database data directory exists
RUN mkdir -p /app/data

# If db.json exists, copy it to the persistent data folder
RUN if [ -f db.json ]; then cp db.json /app/data/db.json; fi

# Expose port 3000 for the Express server
EXPOSE 3000

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/db.json

# Schema changes run in the controlled pre-deploy Cloud Run migration job.
# The service container never mutates its database schema during startup.
CMD ["node", "--import", "tsx", "server.ts"]
