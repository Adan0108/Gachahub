# Local Development

Docker Compose starts the local services needed for GachaHub backend development:

- PostgreSQL on `localhost:5433`
- Redis on `localhost:6379`
- Minio API on `localhost:9000`
- Minio console on `http://localhost:9001`
- Nest backend on `http://localhost:3000`

Elasticsearch is intentionally excluded for now.

## Start the stack

```bash
docker compose up --build
```

The backend container runs Prisma generation, applies existing migrations, and starts Nest in watch mode.

Copy the root `.env.example` to `.env` if you need to change host ports.

## Useful URLs

- Backend API: `http://localhost:3000`
- Swagger docs: `http://localhost:3000/docs`
- Minio console: `http://localhost:9001`

Minio local credentials:

```txt
Username: gachahub
Password: gachahub-local-password
```

## Local connection strings

Use these values when running the backend directly on your host machine:

```env
DATABASE_URL="postgresql://gachahub:gachahub@localhost:5433/gachahub?schema=public"
REDIS_URL="redis://localhost:6379"
MINIO_ENDPOINT="localhost"
MINIO_PORT="9000"
MINIO_USE_SSL="false"
MINIO_ACCESS_KEY="gachahub"
MINIO_SECRET_KEY="gachahub-local-password"
MINIO_BUCKET="gachahub-local"
```

## Stop the stack

```bash
docker compose down
```

To remove local service data:

```bash
docker compose down -v
```
