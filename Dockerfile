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

# Start the application using tsx to run the TypeScript server.
# In Cloud Run/Cloud SQL, PRISMA_DB_PUSH_ON_STARTUP=true lets the container
# create additive schema changes (not destructive migrations) before serving.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ] && [ \"$PRISMA_DB_PUSH_ON_STARTUP\" = \"true\" ]; then npx prisma db push --skip-generate; fi; npx tsx server.ts"]
