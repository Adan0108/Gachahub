<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest 

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Local infrastructure with Docker

The backend uses Docker Compose to run local supporting services such as Redis.

Redis is used for temporary application data such as caching, chat presence, typing indicators, rate limiting, and future background jobs. Permanent application data remains stored in PostgreSQL through Neon and Prisma.

### Requirements

Install Docker Desktop before starting the local infrastructure:

* Windows and macOS: Docker Desktop
* Linux: Docker Engine with Docker Compose

Confirm Docker is running:

```bash
docker --version
docker compose version
```

### First-time setup

After cloning the repository, move into the backend directory:

```bash
cd backend
```

Install the backend dependencies:

```bash
npm install
```

Copy the example environment file:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS or Linux
cp .env.example .env
```

Update `.env` with the required database, authentication, and Redis configuration.

For local Redis, use:

```env
REDIS_URL="redis://localhost:6379"
```

Start the Docker services:

```bash
npm run docker:up
```

Check that the containers are running:

```bash
npm run docker:status
```

Redis should appear as running and healthy.

Start the NestJS backend:

```bash
npm run start:dev
```

### Starting the project normally

When Docker Desktop is already installed and the project has previously been set up, run:

```bash
cd backend
npm run docker:up
npm run start:dev
```

Running `docker:up` again is safe. Docker Compose will reuse the existing container and volume instead of creating duplicate services.

### When the Docker container is already running

You do not need to restart Redis every time.

Check its current status:

```bash
npm run docker:status
```

If Redis is already running, start only the backend:

```bash
npm run start:dev
```

### Docker commands

```bash
# Start the local infrastructure in the background
npm run docker:up

# Show the running services
npm run docker:status

# Follow Docker service logs
npm run docker:logs

# Stop the services
npm run docker:down

# Stop the services and delete their local volumes
npm run docker:reset
```

Use `docker:reset` only when you intentionally want to remove all locally stored Redis data.

Normal shutdown should use:

```bash
npm run docker:down
```

The Redis Docker volume is preserved, so it can be reused the next time the service starts.

### Running Docker Compose directly

Because `docker-compose.yml` is located inside the `backend` directory, Docker Compose commands can also be run directly from that directory:

```bash
docker compose up -d
docker compose ps
docker compose logs -f
docker compose down
```

### Troubleshooting

If Redis does not start, make sure Docker Desktop is running and check the logs:

```bash
npm run docker:logs
```

If port `6379` is already being used, another Redis instance may already be running.

Check the Redis container directly:

```bash
docker exec -it gachahub-redis redis-cli ping
```

A successful response is:

```txt
PONG
```

If the container configuration has changed and needs to be recreated:

```bash
npm run docker:down
npm run docker:up
```

To completely recreate Redis and remove its local volume:

```bash
npm run docker:reset
npm run docker:up
```


## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## Project Structure

Gacha Hub uses a monorepo-style structure with a separated backend and frontend.

```txt
Gacha Hub/
├── backend/                  # NestJS backend API
│   ├── prisma/               # Prisma database schema and migrations
│   │   ├── migrations/        # Generated Prisma migration files
│   │   └── schema.prisma      # Main database schema
│   │
│   ├── src/
│   │   ├── auth/              # Better Auth configuration
│   │   │   └── auth.ts        # Better Auth instance, Prisma adapter, auth settings
│   │   │
│   │   ├── common/            # Shared reusable backend utilities
│   │   │   ├── constants/     # Global constants such as roles and app settings
│   │   │   ├── decorators/    # Custom decorators used across controllers
│   │   │   ├── dto/           # Shared DTOs such as pagination query DTO
│   │   │   ├── filters/       # Global/custom exception filters
│   │   │   ├── guards/        # Reusable guards for roles, permissions, moderation
│   │   │   ├── interceptors/  # Logging and response formatting interceptors
│   │   │   ├── pipes/         # Custom validation/transformation pipes
│   │   │   ├── types/         # Shared TypeScript types
│   │   │   └── utils/         # Shared helper functions such as slugify
│   │   │
│   │   ├── config/            # Environment and app configuration
│   │   │   ├── app.config.ts  # App-level config such as port and frontend URL
│   │   │   └── env.ts         # Central place for reading environment variables
│   │   │
│   │   ├── health/            # Health check endpoints
│   │   │   ├── health.controller.ts
│   │   │   └── health.module.ts
│   │   │
│   │   ├── prisma/            # Prisma service used by NestJS dependency injection
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts
│   │   │
│   │   ├── users/             # User/profile related endpoints
│   │   │   ├── users.controller.ts
│   │   │   ├── users.module.ts
│   │   │   └── users.service.ts
│   │   │
│   │   ├── app.controller.ts  # Root test controller
│   │   ├── app.module.ts      # Root NestJS module
│   │   ├── app.service.ts     # Root test service
│   │   └── main.ts            # Application entry point
│   │
│   ├── test/                  # Backend test files
│   ├── .env.example           # Example environment variables
│   ├── package.json           # Backend dependencies and scripts
│   └── tsconfig.json          # TypeScript configuration
│
├── frontend/                  # React frontend app, added after backend core setup
│
├── .gitignore                 # Git ignored files for backend/frontend
└── README.md                  # Project documentation