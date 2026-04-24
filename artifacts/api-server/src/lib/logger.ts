import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "req.body.password",
    "req.body.newPassword",
    "req.body.oldPassword",
    "req.body.currentPassword",
    "req.body.token",
    "req.body.refreshToken",
    "req.body.resetToken",
    "req.body.secret",
    "req.body.adminPassword",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
