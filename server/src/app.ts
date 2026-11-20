import express from "express";
import type { ErrorRequestHandler, Request } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import type { Connection, Pool } from "oracledb";
import type { UserProfile } from "@bairroativo/shared";
import {
  credentialsInput,
  photoLimit,
  profileInput,
  registrationInput,
  coordinateInput,
  selectedLocationInput,
} from "@bairroativo/shared";
import { z } from "zod";
import {
  authenticatedUser,
  bearerToken,
  login,
  logout,
  register,
  updateProfile,
} from "./auth.ts";
import { isLocalAddress } from "./config.ts";
import {
  health,
  oracleError,
  transaction,
  withConnection,
} from "./database.ts";
import { ApiError, mapError } from "./errors.ts";
import {
  categories,
  changeConfirmation,
  changeStatus,
  communityMetrics,
  createIssue,
  issueDetail,
  issuePhoto,
  listIssues,
  mapIssues,
  locateIssue,
  closeIssue,
} from "./issues.ts";
import {
  listInput,
  parse,
  parseIssue,
  resourceId,
  statusInput,
  validatePhoto,
  addressSearchInput,
} from "./validation.ts";
import { createAddressSearch } from "./geocoding.ts";
import { createPostalCodeCheck } from "./postal-codes.ts";
import { resolveLocation } from "./resolve-location.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fields: 1,
    parts: 3,
    fileSize: photoLimit,
    fieldSize: 16_384,
  },
});
const prefix = "/api/v1";

function allowedOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      (url.hostname === "localhost" || isLocalAddress(url.hostname))
    );
  } catch {
    return false;
  }
}

function requireRole(user: UserProfile, role: UserProfile["role"]) {
  if (user.role !== role) throw new ApiError(403, "FORBIDDEN");
}

export function createApp(pool: Pool, host: string) {
  const searchAddress = createAddressSearch(pool);
  const checkPostalCode = createPostalCodeCheck(pool);
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const origin = request.get("Origin");
    const loopbackAlias =
      host === "127.0.0.1" &&
      (request.hostname === "localhost" || request.hostname === "10.0.2.2");
    if (request.hostname !== host && !loopbackAlias) {
      return next(new ApiError(403, "FORBIDDEN"));
    }
    response.set("X-Content-Type-Options", "nosniff");
    response.vary("Origin");
    if (origin) {
      if (!allowedOrigin(origin)) return next(new ApiError(403, "FORBIDDEN"));
      response.set("Access-Control-Allow-Origin", origin);
      response.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
      response.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key",
      );
    }
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const authLimit = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new ApiError(429, "TOO_MANY_ATTEMPTS")),
  });

  const connect = <T>(run: (connection: Connection) => Promise<T>) =>
    withConnection(pool, run);
  const identify = <T>(
    request: Request,
    run: (connection: Connection, user: UserProfile) => Promise<T>,
  ) => {
    const token = bearerToken(request.get("Authorization"));
    return connect(async (connection) =>
      run(connection, await authenticatedUser(connection, token)),
    );
  };

  app.get(prefix + "/health", async (_request, response) => {
    try {
      await connect(health);
      response.json({ data: { process: "up", database: "up" } });
    } catch {
      response.status(503).json({ data: { process: "up", database: "down" } });
    }
  });

  app.use(prefix + "/auth", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.post(prefix + "/auth/register", authLimit, async (request, response) => {
    const input = parse(registrationInput, request.body);
    response.status(201).json({
      data: await connect((connection) => register(connection, input)),
    });
  });
  app.post(prefix + "/auth/login", authLimit, async (request, response) => {
    const { email, password } = parse(credentialsInput, request.body);
    response.json({
      data: await connect((connection) => login(connection, email, password)),
    });
  });
  app.get(prefix + "/auth/profile", async (request, response) => {
    response.json({
      data: await identify(request, async (_connection, user) => user),
    });
  });
  app.patch(prefix + "/auth/profile", async (request, response) => {
    const { name } = parse(profileInput, request.body);
    response.json({
      data: await identify(request, (connection, user) =>
        transaction(connection, () => updateProfile(connection, user, name)),
      ),
    });
  });
  app.delete(prefix + "/auth/session", async (request, response) => {
    const token = bearerToken(request.get("Authorization"));
    await connect((connection) =>
      transaction(connection, () => logout(connection, token)),
    );
    response.json({ data: null });
  });

  app.get(prefix + "/categories", async (_request, response) => {
    response.json({ data: await connect(categories) });
  });

  app.post(
    prefix + "/locations/search",
    authLimit,
    async (request, response) => {
      const { query } = parse(addressSearchInput, request.body);
      await identify(request, async () => undefined);
      response.json({ data: await searchAddress(query) });
    },
  );

  app.post(
    prefix + "/locations/reverse",
    authLimit,
    async (request, response) => {
      const { candidate, ...point } = parse(
        coordinateInput.extend({ candidate: selectedLocationInput.optional() }),
        request.body,
      );
      await identify(request, async () => undefined);
      const location = await resolveLocation(
        point,
        candidate,
        () =>
          searchAddress(
            "reverse:" + point.latitude + "," + point.longitude,
            point,
          ),
        checkPostalCode,
      );
      response.json({ data: location });
    },
  );

  app.patch(prefix + "/issues/:id/location", async (request, response) => {
    const id = parse(resourceId, request.params.id);
    const location = parse(selectedLocationInput, request.body);
    const data = await identify(request, (connection, user) =>
      transaction(connection, async () => {
        await locateIssue(connection, user.id, id, location);
        return issueDetail(connection, user.id, id);
      }),
    );
    response.json({ data });
  });

  app.get(prefix + "/issues", async (request, response) => {
    const query = parse(listInput, request.query);
    response.json({
      data: await identify(request, (connection, user) =>
        listIssues(connection, user.id, query),
      ),
    });
  });

  app.get(prefix + "/issues/map", async (request, response) => {
    const query = parse(listInput, request.query);
    response.json({
      data: await identify(request, (connection, user) =>
        transaction(
          connection,
          () => mapIssues(connection, user.id, query),
          true,
        ),
      ),
    });
  });

  app.get(prefix + "/issues/:id", async (request, response) => {
    const id = parse(resourceId, request.params.id);
    const data = await identify(request, (connection, user) =>
      transaction(connection, () => issueDetail(connection, user.id, id), true),
    );
    response.json({ data });
  });

  app.get(prefix + "/issues/:id/photo", async (request, response) => {
    const id = parse(resourceId, request.params.id);
    const photo = await identify(request, (connection) =>
      issuePhoto(connection, id),
    );
    response
      .type(photo.mime)
      .set("Cache-Control", "private, no-store")
      .send(photo.buffer);
  });

  app.post(
    prefix + "/issues",
    upload.single("photo"),
    async (request, response) => {
      const input = parseIssue(
        request.body,
        Boolean(request.is("multipart/form-data")),
      );
      const key = parse(z.uuidv4(), request.get("Idempotency-Key"));
      const photo = validatePhoto(request.file);
      const result = await identify(request, (connection, user) => {
        requireRole(user, "CITIZEN");
        return transaction(connection, async () => {
          const { id, created } = await createIssue(
            connection,
            user.id,
            input,
            key,
            photo,
          );
          return { data: await issueDetail(connection, user.id, id), created };
        });
      });
      response
        .status(result.created ? 201 : 200)
        .location(prefix + "/issues/" + result.data.id)
        .json({ data: result.data });
    },
  );

  for (const method of ["post", "delete"] as const) {
    app[method](
      prefix + "/issues/:id/confirmations",
      async (request, response) => {
        const id = parse(resourceId, request.params.id);
        const data = await identify(request, (connection, user) => {
          requireRole(user, "CITIZEN");
          return transaction(connection, async () => {
            await changeConfirmation(
              connection,
              user.id,
              id,
              method === "post",
            );
            return issueDetail(connection, user.id, id);
          });
        });
        response.status(method === "post" ? 201 : 200).json({ data });
      },
    );
  }

  app.post(prefix + "/issues/:id/close", async (request, response) => {
    const id = parse(resourceId, request.params.id);
    const { note } = parse(
      z.strictObject({ note: z.string().trim().max(500).optional() }),
      request.body ?? {},
    );
    const data = await identify(request, (connection, user) =>
      transaction(connection, async () => {
        await closeIssue(connection, user.id, id, note);
        return issueDetail(connection, user.id, id);
      }),
    );
    response.json({ data });
  });

  app.patch(prefix + "/issues/:id/status", async (request, response) => {
    const id = parse(resourceId, request.params.id);
    const { status, note } = parse(statusInput, request.body);
    const data = await identify(request, (connection, user) => {
      requireRole(user, "OPERATOR");
      return transaction(connection, async () => {
        await changeStatus(connection, user.id, id, status, note);
        return issueDetail(connection, user.id, id);
      });
    });
    response.json({ data });
  });

  app.get(prefix + "/metrics", async (request, response) => {
    const data = await identify(request, (connection) =>
      transaction(connection, () => communityMetrics(connection), true),
    );
    response.json({ data });
  });

  app.use((_request, _response, next) => next(new ApiError(404, "NOT_FOUND")));

  const handleError: ErrorRequestHandler = (
    error: unknown,
    request,
    response,
    next,
  ) => {
    if (response.headersSent) return next(error);
    const mapped =
      error instanceof multer.MulterError
        ? error.code === "LIMIT_FILE_SIZE"
          ? new ApiError(413, "PHOTO_TOO_LARGE")
          : new ApiError(422, "INVALID_INPUT")
        : mapError(error);
    if (mapped.status >= 500) {
      console.error("API request failed", {
        method: request.method,
        code: oracleError(error)?.code ?? mapped.code,
      });
    }
    response
      .status(mapped.status)
      .json({ error: { code: mapped.code, field: mapped.field } });
  };
  app.use(handleError);
  return app;
}
