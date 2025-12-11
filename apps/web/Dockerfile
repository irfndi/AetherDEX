FROM oven/bun:1-alpine

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./

# Copy app specific package.json
COPY apps/web/package.json ./apps/web/

# Copy packages directory to satisfy workspace requirements
COPY packages ./packages

# Install dependencies
RUN bun install

# Copy app source
COPY apps/web ./apps/web

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["bun", "run", "dev"]
