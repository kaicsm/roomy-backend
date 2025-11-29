import Elysia, { Cookie, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { UserRepository } from "../repositories/user.repo";
import { AuthService } from "../services/auth.service";
import { type SafeUser } from "../domain/user.types";

export const AuthController = new Elysia({
  prefix: "/auth",
  cookie: {
    secrets: process.env.COOKIE_SECRET!,
    sign: ["authToken"],
  },
})
  .decorate("authService", new AuthService(new UserRepository()))
  .use(
    jwt({
      name: "jwt",
      secret: process.env.JWT_SECRET!,
    }),
  )
  .decorate(
    "saveAuthCookie",
    async (jwt: any, user: SafeUser, authToken: Cookie<unknown>) => {
      const token = await jwt.sign({ sub: user.id, email: user.email });

      authToken.set({
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });
    },
  )
  .post(
    "/login",
    async ({
      body,
      jwt,
      cookie: { authToken },
      saveAuthCookie,
      authService,
    }) => {
      const user = await authService.login(body);
      await saveAuthCookie(jwt, user, authToken!);

      return { user };
    },
    {
      body: t.Object({
        username: t.String({
          minLength: 4,
        }),
        password: t.String({
          minLength: 6,
        }),
      }),
    },
  )
  .post(
    "/register",
    async ({
      body,
      jwt,
      cookie: { authToken },
      saveAuthCookie,
      authService,
    }) => {
      const user = await authService.register(body);
      await saveAuthCookie(jwt, user, authToken!);

      return { user };
    },
    {
      body: t.Object({
        username: t.String({
          minLength: 4,
        }),
        password: t.String({
          minLength: 6,
        }),
        email: t.String({
          format: "email",
        }),
      }),
    },
  )
  .post("/logout", async ({ cookie: { authToken } }) => {
    authToken.remove();
    return { message: "Logout successfully" };
  });
