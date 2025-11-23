import Elysia from "elysia";
import { AuthController } from "./core/controllers/auth.controller";
import { RoomController } from "./core/controllers/room.controller";
import { UserController } from "./core/controllers/user.controller";
import { config } from "dotenv";
import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";

config();

const requiredEnvVars = [
  "PORT",
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "COOKIE_SECRET",
];

const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName],
);

if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`,
  );
  process.exit(1);
}

const PORT = process.env.PORT!;

new Elysia({ prefix: "/api" })
  .use(cors())
  .use(
    openapi({
      documentation: {
        info: {
          title: "Roomy API",
          version: "1.0.0",
        },
      },
    }),
  )
  .group("/v1", (group) =>
    group.use(AuthController).use(RoomController).use(UserController),
  )
  .listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}/api`);
  });
