import Elysia, { t } from "elysia";
import { UserRepository } from "../repositories/user.repo";
import { authMiddleware } from "../middlewares/auth.middleware";
import { UserService } from "../services/user.service";

export const UserController = new Elysia({ prefix: "/users" })
  .decorate("userService", new UserService(new UserRepository()))
  .use(authMiddleware)
  .get(
    "/:id",
    async ({ params, userService }) => {
      return await userService.findUserById(params.id);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      auth: true,
    },
  )
  .get(
    "/me",
    async ({ userService, payload }) => {
      return await userService.findUserById(payload.sub);
    },
    { auth: true },
  )
  .get(
    "/",
    async ({ query, userService }) => {
      return await userService.findUsersByIds(query.ids!);
    },
    {
      query: t.Object({
        ids: t.Optional(t.String()),
      }),
      auth: true,
    },
  );
