import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import type { Server } from "node:http";
import type { Pool } from "oracledb";
import type {
  ApiErrorCode,
  Category,
  AuthSession,
  IssueMap,
  UserProfile,
  Issue,
  IssueDetail,
  Metrics,
  Page,
} from "@bairroativo/shared";
import { issueInput } from "@bairroativo/shared";
import { createIssue as insertIssue } from "../src/issues.ts";
import { createApp } from "../src/app.ts";
import {
  openPool,
  rows,
  transaction,
  withConnection,
} from "../src/database.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const host = "127.0.0.1";

async function listen(pool: Pool) {
  const server = createApp(pool, host).listen(0, host);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return { server, url: `http://${host}:${address.port}/api/v1` };
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("real HTTP integration with the running Oracle instance", async (suite) => {
  let pool = await openPool();
  let { server, url } = await listen(pool);
  const nonce = randomUUID();
  const keys = [randomUUID(), randomUUID()];
  const emails = ["morador", "vizinho", "agente"].map(
    (name) => name + "-" + nonce + "@example.test",
  );
  const password = randomUUID();
  const sessions = new Map<number, string>();
  let fixtureId: number;
  let citizen: UserProfile;
  let second: UserProfile;
  let operator: UserProfile;
  let category: Category;
  let before: Metrics;

  async function request(
    path: string,
    { user, ...init }: RequestInit & { user?: number } = {},
  ) {
    const headers = new Headers(init.headers);
    if (user) {
      const token = sessions.get(user);
      assert(token);
      headers.set("Authorization", "Bearer " + token);
    }
    if (typeof init.body === "string")
      headers.set("Content-Type", "application/json");
    return fetch(url + path, { ...init, headers });
  }

  async function expect<T>(response: Response, status: number): Promise<T> {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body.data;
  }

  async function reject(
    response: Response,
    status: number,
    code: ApiErrorCode,
  ) {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.deepEqual(Object.keys(body), ["error"]);
  }

  async function register(index: number) {
    const email = emails[index];
    const session = await expect<AuthSession>(
      await request("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: "Conta de teste " + index,
          email,
          password,
        }),
      }),
      201,
    );
    assert.equal(session.user.role, "CITIZEN");
    assert.equal(session.user.email, email);
    sessions.set(session.user.id, session.token);
    return session.user;
  }

  function draft(title: string) {
    return {
      title,
      categoryId: category.id,
      severity: "HIGH",
      description: "Relato automatizado de teste sobre danos na Rua do Cedro.",
      neighborhood: "Jardim Ipê " + nonce.slice(0, 8),
      address: "Rua do Cedro, 123",
      postalCode: "12345-678",
      latitude: -23.501,
      longitude: -46.622,
    };
  }

  function multipart(
    input: ReturnType<typeof draft>,
    bytes: BlobPart = new Uint8Array(png),
  ) {
    const data = new FormData();
    data.append("issue", JSON.stringify(input));
    data.append("photo", new Blob([bytes], { type: "image/png" }), "issue.png");
    return data;
  }

  function create(key: string, body: BodyInit, user = citizen.id) {
    return request("/issues", {
      user,
      method: "POST",
      body,
      headers: { "Idempotency-Key": key },
    });
  }

  const firstTitle = "Validação API " + nonce;

  try {
    await suite.test(
      "health, registered identities, seeded categories and initial metrics",
      async () => {
        assert.deepEqual(await expect(await request("/health"), 200), {
          process: "up",
          database: "up",
        });
        citizen = await register(0);
        second = await register(1);
        operator = await register(2);
        await withConnection(pool, (connection) =>
          transaction(connection, async () => {
            await connection.execute(
              "UPDATE app_user SET role = 'OPERATOR' WHERE id = :id",
              { id: operator.id },
            );
          }),
        );
        operator = await expect<UserProfile>(
          await request("/auth/profile", { user: operator.id }),
          200,
        );
        assert.equal(operator.role, "OPERATOR");
        const categories = await expect<Category[]>(
          await request("/categories"),
          200,
        );
        [category] = categories;
        assert(categories.length >= 6);
        before = await expect<Metrics>(
          await request("/metrics", { user: citizen.id }),
          200,
        );
        assert.equal(
          before.total,
          before.open + before.inProgress + before.resolved + before.closed,
        );
      },
    );

    await suite.test(
      "login, profile updates and logout use revocable sessions",
      async () => {
        const login = (secret: string) =>
          request("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: citizen.email, password: secret }),
          });
        await reject(
          await login("password verification failure"),
          401,
          "INVALID_CREDENTIALS",
        );
        await reject(
          await request("/auth/register", {
            method: "POST",
            body: JSON.stringify({
              email: "role-" + emails[0],
              name: "Teste",
              password,
              role: "OPERATOR",
            }),
          }),
          422,
          "INVALID_INPUT",
        );
        await reject(
          await request("/auth/register", {
            method: "POST",
            body: JSON.stringify({
              email: " " + citizen.email.toUpperCase() + " ",
              name: "Teste",
              password,
            }),
          }),
          409,
          "EMAIL_IN_USE",
        );
        await reject(
          await request("/auth/profile", {
            user: citizen.id,
            method: "PATCH",
            body: JSON.stringify({ name: citizen.name, role: "OPERATOR" }),
          }),
          422,
          "INVALID_INPUT",
        );

        const signedIn = await expect<AuthSession>(await login(password), 200);
        assert.equal(signedIn.user.id, citizen.id);
        assert.notEqual(signedIn.token, sessions.get(citizen.id));
        const headers = { Authorization: "Bearer " + signedIn.token };
        const updated = await expect<UserProfile>(
          await request("/auth/profile", {
            headers,
            method: "PATCH",
            body: JSON.stringify({ name: "Nome atualizado" }),
          }),
          200,
        );
        assert.equal(updated.name, "Nome atualizado");
        assert.equal(updated.role, "CITIZEN");
        assert.equal(
          (
            await expect<UserProfile>(
              await request("/auth/profile", { user: citizen.id }),
              200,
            )
          ).name,
          updated.name,
        );
        await expect(
          await request("/auth/session", { headers, method: "DELETE" }),
          200,
        );
        await reject(
          await request("/auth/profile", { headers }),
          401,
          "INVALID_IDENTITY",
        );
      },
    );

    await suite.test(
      "validates request data, identities, permissions and photo limits",
      async () => {
        await reject(await request("/issues"), 401, "INVALID_IDENTITY");
        await reject(
          await request("/issues", {
            headers: { "X-Demo-User-Id": String(citizen.id) },
          }),
          401,
          "INVALID_IDENTITY",
        );
        await reject(
          await request("/issues?limit=500", { user: citizen.id }),
          422,
          "INVALID_INPUT",
        );
        await reject(
          await create(
            keys[0],
            JSON.stringify({
              ...draft(firstTitle),
              latitude: undefined,
              longitude: undefined,
            }),
          ),
          422,
          "INVALID_INPUT",
        );
        await reject(
          await create(
            keys[0],
            JSON.stringify({ ...draft("xx"), latitude: 99 }),
          ),
          422,
          "INVALID_INPUT",
        );
        await reject(
          await create(
            keys[0],
            JSON.stringify({ ...draft(firstTitle), categoryId: 9_999_999 }),
          ),
          422,
          "INVALID_INPUT",
        );
        await reject(
          await create(keys[0], JSON.stringify(draft(firstTitle)), operator.id),
          403,
          "FORBIDDEN",
        );
        await reject(
          await create(
            keys[0],
            multipart(draft(firstTitle), "Not a real image"),
          ),
          422,
          "INVALID_PHOTO",
        );
        await reject(
          await create(
            keys[0],
            multipart(draft(firstTitle), new Uint8Array(5 * 1024 * 1024 + 1)),
          ),
          413,
          "PHOTO_TOO_LARGE",
        );
      },
    );

    await suite.test(
      "creates the issue and binary photo atomically with concurrent replay protection",
      async () => {
        const input = draft(firstTitle);
        const replies = await Promise.all([
          create(keys[0], multipart(input)),
          create(keys[0], multipart(input)),
        ]);
        replies.sort((a, b) => b.status - a.status);
        const issue = await expect<IssueDetail>(replies[0], 201);
        fixtureId = issue.id;
        assert.equal(
          (await expect<IssueDetail>(replies[1], 200)).id,
          fixtureId,
        );
        assert.equal(issue.hasPhoto, true);
        assert.equal(issue.latitude, input.latitude);
        assert.equal(issue.postalCode, "12345678");
        assert(!("email" in issue.author));
        assert.equal(issue.history.length, 1);
        assert.equal(issue.priorityScore, 30);
        assert.equal(issue.severityPoints, 30);
        assert.equal(issue.isSample, false);
        await reject(
          await create(keys[0], multipart(draft(firstTitle + " changed"))),
          409,
          "REQUEST_CONFLICT",
        );

        await withConnection(pool, async (connection) => {
          const [stored] = await rows<{ id: number; bytes: number }>(
            connection,
            'SELECT id AS "id", dbms_lob.getlength(photo) AS "bytes" FROM issue WHERE request_key = :key',
            { key: keys[0] },
          );
          assert.deepEqual(stored, { id: fixtureId, bytes: png.length });
        });
        const photoPath = "/issues/" + fixtureId + "/photo";
        await reject(await request(photoPath), 401, "INVALID_IDENTITY");
        const retrieved = await request(photoPath, { user: citizen.id });
        assert.equal(retrieved.status, 200);
        assert.equal(retrieved.headers.get("Content-Type"), "image/png");
        assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()), png);
      },
    );

    await suite.test(
      "filters without accents, orders by priority, paginates and returns the viewer's issues",
      async () => {
        const another = await expect<IssueDetail>(
          await create(
            keys[1],
            JSON.stringify({
              ...draft("Validação API complementar " + nonce),
              severity: "LOW",
              description: undefined,
              latitude: -23.55,
              longitude: -46.65,
              postalCode: undefined,
            }),
            second.id,
          ),
          201,
        );
        await withConnection(pool, (connection) =>
          transaction(connection, async () => {
            await connection.execute(
              "UPDATE issue_location SET latitude = NULL, longitude = NULL WHERE id = (SELECT location_id FROM issue WHERE id = :id)",
              { id: another.id },
            );
          }),
        );
        const path = `/issues?search=validacao%20api&category=${category.id}&status=OPEN&order=priority&limit=1`;
        const filtered = await expect<Page<Issue>>(
          await request(path, { user: citizen.id }),
          200,
        );
        assert.equal(filtered.items[0].id, fixtureId);
        assert.equal(filtered.nextOffset, 1);
        const next = await expect<Page<Issue>>(
          await request(path + "&offset=1", { user: citizen.id }),
          200,
        );
        assert.equal(next.items[0].id, another.id);
        const own = await expect<Page<Issue>>(
          await request(path + "&mine=true", { user: citizen.id }),
          200,
        );
        assert.deepEqual(
          own.items.map(({ id }) => id),
          [fixtureId],
        );
        const neighborhood = encodeURIComponent(
          "Jardim Ipe " + nonce.slice(0, 8),
        );
        const region = await expect<Page<Issue>>(
          await request("/issues?search=" + neighborhood, { user: citizen.id }),
          200,
        );
        assert.equal(region.items.length, 2);
        assert.equal(another.description, null);
        assert.equal(another.postalCode, null);
        const map = await expect<IssueMap>(
          await request("/issues/map?search=" + neighborhood + "&status=OPEN", {
            user: citizen.id,
          }),
          200,
        );
        assert.deepEqual(
          map.points.map(({ id }) => id),
          [fixtureId],
        );
        assert.equal(map.points[0].latitude, -23.501);
        assert.equal(map.points[0].longitude, -46.622);
        const byPostalCode = await expect<Page<Issue>>(
          await request("/issues?search=12345-678", { user: citizen.id }),
          200,
        );
        assert(byPostalCode.items.some(({ id }) => id === fixtureId));
      },
    );

    await suite.test(
      "authenticated address search reads the Oracle cache",
      async () => {
        const query = "public place fixture " + nonce;
        const hash = createHash("sha256")
          .update("v3:" + query)
          .digest();
        const matches = [
          {
            latitude: -23.55,
            longitude: -46.63,
            label: "Cached test place",
            neighborhood: "Test district",
            address: "Test address",
            postalCode: "01310000",
          },
        ];
        try {
          await withConnection(pool, async (connection) => {
            await connection.execute(
              "INSERT INTO address_search_cache (query_hash, result_json, expires_at) VALUES (:hash, :result, systimestamp + INTERVAL '1' HOUR)",
              { hash, result: JSON.stringify(matches) },
              { autoCommit: true },
            );
          });
          await reject(
            await request("/locations/search", {
              method: "POST",
              body: JSON.stringify({ query }),
            }),
            401,
            "INVALID_IDENTITY",
          );
          const result = await expect(
            await request("/locations/search", {
              user: citizen.id,
              method: "POST",
              body: JSON.stringify({ query }),
            }),
            200,
          );
          assert.deepEqual(result, matches);
          await reject(
            await request("/locations/search", {
              user: citizen.id,
              method: "POST",
              body: JSON.stringify({ query: "short" }),
            }),
            422,
            "INVALID_INPUT",
          );
        } finally {
          await withConnection(pool, async (connection) => {
            await connection.execute(
              "DELETE FROM address_search_cache WHERE query_hash = :hash",
              { hash },
              { autoCommit: true },
            );
          });
        }
      },
    );

    await suite.test(
      "reverse lookup preserves device coordinates and fills address attributes",
      async () => {
        const point = { latitude: -23.5557603, longitude: -46.6626616 };
        const query = "reverse:" + point.latitude + "," + point.longitude;
        const hash = createHash("sha256")
          .update("v3:" + query)
          .digest();
        const match = {
          latitude: -23.556,
          longitude: -46.663,
          label: "Public test place",
          neighborhood: "Consolação",
          address: "Avenida Paulista, São Paulo",
          postalCode: "01310300",
          city: "São Paulo",
          state: "SP",
        };
        const postalHash = createHash("sha256")
          .update("postal:v1:01310300")
          .digest();
        let previousPostal: { result: string; expires: Date }[] = [];
        try {
          await withConnection(pool, async (connection) => {
            await connection.execute(
              "MERGE INTO address_search_cache target USING (SELECT :hash query_hash FROM dual) source ON (target.query_hash = source.query_hash) WHEN MATCHED THEN UPDATE SET result_json = :result, expires_at = systimestamp + INTERVAL '1' HOUR WHEN NOT MATCHED THEN INSERT (query_hash, result_json, expires_at) VALUES (:hash, :result, systimestamp + INTERVAL '1' HOUR)",
              { hash, result: JSON.stringify([match]) },
              { autoCommit: true },
            );
          });
          await withConnection(pool, async (connection) => {
            previousPostal = await rows(
              connection,
              'SELECT result_json AS "result", expires_at AS "expires" FROM address_search_cache WHERE query_hash = :hash',
              { hash: postalHash },
            );
            await connection.execute(
              "MERGE INTO address_search_cache target USING (SELECT :hash query_hash FROM dual) source ON (target.query_hash = source.query_hash) WHEN MATCHED THEN UPDATE SET result_json = :result, expires_at = systimestamp + INTERVAL '1' HOUR WHEN NOT MATCHED THEN INSERT (query_hash, result_json, expires_at) VALUES (:hash, :result, systimestamp + INTERVAL '1' HOUR)",
              {
                hash: postalHash,
                result: JSON.stringify({
                  cep: "01310-300",
                  localidade: "São Paulo",
                  uf: "SP",
                }),
              },
              { autoCommit: true },
            );
          });
          const body = JSON.stringify(point);
          await reject(
            await request("/locations/reverse", { method: "POST", body }),
            401,
            "INVALID_IDENTITY",
          );
          const result = await expect(
            await request("/locations/reverse", {
              user: citizen.id,
              method: "POST",
              body,
            }),
            200,
          );
          assert.deepEqual(result, { ...match, ...point });
          await reject(
            await request("/locations/reverse", {
              user: citizen.id,
              method: "POST",
              body: JSON.stringify({ ...point, latitude: 91 }),
            }),
            422,
            "INVALID_INPUT",
          );
        } finally {
          await withConnection(pool, async (connection) => {
            if (previousPostal[0]) {
              await connection.execute(
                "UPDATE address_search_cache SET result_json = :result, expires_at = :expires WHERE query_hash = :hash",
                { hash: postalHash, ...previousPostal[0] },
                { autoCommit: true },
              );
            } else {
              await connection.execute(
                "DELETE FROM address_search_cache WHERE query_hash = :hash",
                { hash: postalHash },
                { autoCommit: true },
              );
            }
          });
          await withConnection(pool, async (connection) => {
            await connection.execute(
              "DELETE FROM address_search_cache WHERE query_hash = :hash",
              { hash },
              { autoCommit: true },
            );
          });
        }
      },
    );

    await suite.test(
      "date filters include whole Brasilia days in lists and maps",
      async () => {
        const input = { user: citizen.id };
        const unfiltered = await expect<Page<Issue>>(
          await request("/issues?search=" + nonce, input),
          200,
        );
        const secondId = unfiltered.items.find(
          ({ id }) => id !== fixtureId,
        )?.id;
        assert(secondId);
        await withConnection(pool, (connection) =>
          transaction(connection, async () => {
            await connection.execute(
              "UPDATE issue SET created_at = to_timestamp_tz('2026-11-18 00:00:00 -03:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM') WHERE id = :id",
              { id: fixtureId },
            );
            await connection.execute(
              "UPDATE issue SET created_at = to_timestamp_tz('2026-11-19 00:00:00 -03:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM') WHERE id = :id",
              { id: secondId },
            );
          }),
        );
        const query =
          "?search=" + nonce + "&startDate=2026-11-18&endDate=2026-11-18";
        const page = await expect<Page<Issue>>(
          await request("/issues" + query, input),
          200,
        );
        assert.deepEqual(
          page.items.map(({ id }) => id),
          [fixtureId],
        );
        const map = await expect<IssueMap>(
          await request("/issues/map" + query, input),
          200,
        );
        assert.deepEqual(
          map.points.map(({ id }) => id),
          [fixtureId],
        );
        assert.equal(map.unlocated.length, 0);
        await withConnection(pool, (connection) =>
          transaction(connection, async () => {
            await connection.execute(
              "UPDATE issue SET created_at = to_timestamp_tz('2026-11-18 23:59:59.999 -03:00', 'YYYY-MM-DD HH24:MI:SS.FF3 TZH:TZM') WHERE id = :id",
              { id: fixtureId },
            );
          }),
        );
        assert.equal(
          (
            await expect<Page<Issue>>(
              await request("/issues" + query, input),
              200,
            )
          ).items[0]?.id,
          fixtureId,
        );
        await reject(
          await request(
            "/issues?startDate=2026-11-19&endDate=2026-11-18",
            input,
          ),
          422,
          "INVALID_INPUT",
        );
        await reject(
          await request("/issues/map?endDate=2026-02-30", input),
          422,
          "INVALID_INPUT",
        );
      },
    );

    await suite.test(
      "authors can locate old reports while other residents cannot change their position",
      async () => {
        const input = { user: citizen.id };
        const unresolved = await expect<IssueMap>(
          await request("/issues/map?search=" + nonce, input),
          200,
        );
        const report = unresolved.unlocated[0];
        assert(report);
        const path = "/issues/" + report.id + "/location";
        const body = JSON.stringify({
          latitude: -23.555,
          longitude: -46.66,
          label: "Local escolhido",
          neighborhood: "Bela Vista",
          address: "Avenida Paulista, São Paulo",
          postalCode: "01310000",
        });
        await reject(
          await request(path, { user: citizen.id, method: "PATCH", body }),
          403,
          "FORBIDDEN",
        );
        const located = await expect<IssueDetail>(
          await request(path, { user: second.id, method: "PATCH", body }),
          200,
        );
        assert.equal(located.latitude, -23.555);
        assert.equal(located.longitude, -46.66);
        assert.equal(located.neighborhood, "Bela Vista");
        assert.equal(located.address, "Avenida Paulista, São Paulo");
        assert.equal(located.postalCode, "01310000");
        await reject(
          await request(path, { user: second.id, method: "PATCH", body }),
          409,
          "REQUEST_CONFLICT",
        );
        const updated = await expect<IssueMap>(
          await request("/issues/map?search=" + nonce, input),
          200,
        );
        assert.equal(updated.points.length, 2);
        assert.equal(updated.unlocated.length, 0);
      },
    );

    await suite.test(
      "confirmation uniqueness, identity isolation, priority and removal",
      async () => {
        const path = `/issues/${fixtureId}/confirmations`;
        const responses = await Promise.all([
          request(path, { user: second.id, method: "POST" }),
          request(path, { user: second.id, method: "POST" }),
        ]);
        responses.sort((a, b) => a.status - b.status);
        const confirmed = await expect<IssueDetail>(responses[0], 201);
        assert.equal(confirmed.confirmed, true);
        assert.equal(confirmed.confirmationCount, 1);
        assert.equal(confirmed.priorityScore, 32);
        await reject(responses[1], 409, "ALREADY_CONFIRMED");
        const authorView = await expect<IssueDetail>(
          await request("/issues/" + fixtureId, { user: citizen.id }),
          200,
        );
        assert.equal(authorView.confirmed, false);
        const removed = await expect<IssueDetail>(
          await request(path, { user: second.id, method: "DELETE" }),
          200,
        );
        assert.equal(removed.confirmed, false);
        assert.equal(removed.confirmationCount, 0);
        assert.equal(removed.priorityScore, 30);
      },
    );

    await suite.test(
      "operator-only transitions, resolution rule, history and live metrics",
      async () => {
        const path = `/issues/${fixtureId}/status`;
        const update = (user: number, status: string, note?: string) =>
          request(path, {
            user,
            method: "PATCH",
            body: JSON.stringify({ status, note }),
          });

        await reject(await update(citizen.id, "IN_PROGRESS"), 403, "FORBIDDEN");
        await reject(
          await update(operator.id, "RESOLVED"),
          409,
          "INVALID_TRANSITION",
        );
        const progress = await expect<IssueDetail>(
          await update(
            operator.id,
            "IN_PROGRESS",
            "Acompanhamento interno de teste.",
          ),
          200,
        );
        assert.equal(progress.history[0].previousStatus, "OPEN");
        assert.equal(progress.history[0].actorName, operator.name);
        assert.equal(
          progress.history[0].note,
          "Acompanhamento interno de teste.",
        );
        const resolved = await expect<IssueDetail>(
          await update(operator.id, "RESOLVED"),
          200,
        );
        assert.equal(resolved.status, "RESOLVED");
        assert.equal(resolved.history.length, 3);
        await reject(
          await update(operator.id, "OPEN"),
          409,
          "INVALID_TRANSITION",
        );
        await reject(
          await request(`/issues/${fixtureId}/confirmations`, {
            user: second.id,
            method: "POST",
          }),
          409,
          "RESOLVED",
        );
        const after = await expect<Metrics>(
          await request("/metrics", { user: citizen.id }),
          200,
        );
        assert.equal(after.total, before.total + 2);
        assert.equal(after.open, before.open + 1);
        assert.equal(after.resolved, before.resolved + 1);
        assert.equal(
          after.categories.find(({ id }) => id === category.id)?.count,
          (before.categories.find(({ id }) => id === category.id)?.count ?? 0) +
            2,
        );
        assert(
          after.neighborhoods.length > 0 && after.neighborhoods.length <= 10,
        );
        for (const { name, count } of after.neighborhoods) {
          const previous = before.neighborhoods.find(
            (row) => row.name === name,
          );
          if (previous) {
            assert.equal(count, previous.count + Number(name === "Bela Vista"));
          } else if (name === draft(firstTitle).neighborhood) {
            assert.equal(count, 1);
          }
        }
      },
    );

    await suite.test(
      "only authors can close reports while retaining photos, location and history",
      async () => {
        const baseline = await expect<Metrics>(
          await request("/metrics", { user: citizen.id }),
          200,
        );
        const key = randomUUID();
        keys.push(key);
        const report = await expect<IssueDetail>(
          await create(
            key,
            multipart(draft("Encerramento " + nonce)),
            second.id,
          ),
          201,
        );
        const path = `/issues/${report.id}/close`;
        const body = JSON.stringify({
          note: "Encerramento solicitado pelo autor no teste.",
        });
        await reject(
          await request(path, { method: "POST", body }),
          401,
          "INVALID_IDENTITY",
        );
        await reject(
          await request(path, { user: citizen.id, method: "POST", body }),
          403,
          "FORBIDDEN",
        );
        await reject(
          await request(path, { user: operator.id, method: "POST", body }),
          403,
          "FORBIDDEN",
        );
        await reject(
          await request(`/issues/${fixtureId}/close`, {
            user: citizen.id,
            method: "POST",
            body,
          }),
          409,
          "INVALID_TRANSITION",
        );
        await expect(
          await request(`/issues/${report.id}/confirmations`, {
            user: citizen.id,
            method: "POST",
          }),
          201,
        );
        const closed = await expect<IssueDetail>(
          await request(path, { user: second.id, method: "POST", body }),
          200,
        );
        assert.equal(closed.status, "CLOSED");
        assert.equal(closed.hasPhoto, true);
        assert.equal(closed.address, report.address);
        assert.equal(closed.latitude, report.latitude);
        assert.equal(closed.confirmationCount, 1);
        assert.equal(closed.history[0].actorName, second.name);
        assert.equal(closed.history[0].previousStatus, "OPEN");
        assert.equal(
          closed.history[0].note,
          "Encerramento solicitado pelo autor no teste.",
        );
        const replay = await expect<IssueDetail>(
          await request(path, { user: second.id, method: "POST", body }),
          200,
        );
        assert.equal(replay.history.length, closed.history.length);
        await reject(
          await request(path, { user: citizen.id, method: "POST", body }),
          403,
          "FORBIDDEN",
        );
        await reject(
          await request(`/issues/${report.id}/confirmations`, {
            user: second.id,
            method: "POST",
          }),
          409,
          "CLOSED",
        );
        await reject(
          await request(`/issues/${report.id}/status`, {
            user: operator.id,
            method: "PATCH",
            body: JSON.stringify({ status: "IN_PROGRESS" }),
          }),
          409,
          "INVALID_TRANSITION",
        );
        assert.deepEqual(
          Buffer.from(
            await (
              await request(`/issues/${report.id}/photo`, { user: citizen.id })
            ).arrayBuffer(),
          ),
          png,
        );
        const list = await expect<Page<Issue>>(
          await request("/issues?status=CLOSED&search=" + nonce, {
            user: citizen.id,
          }),
          200,
        );
        assert(list.items.some((issue) => issue.id === report.id));
        const map = await expect<IssueMap>(
          await request("/issues/map?status=CLOSED&search=" + nonce, {
            user: citizen.id,
          }),
          200,
        );
        assert(map.points.some((issue) => issue.id === report.id));
        const progressKey = randomUUID();
        keys.push(progressKey);
        const progress = await expect<IssueDetail>(
          await create(
            progressKey,
            JSON.stringify(draft("Em andamento " + nonce)),
          ),
          201,
        );
        await expect(
          await request(`/issues/${progress.id}/status`, {
            user: operator.id,
            method: "PATCH",
            body: JSON.stringify({ status: "IN_PROGRESS" }),
          }),
          200,
        );
        const ended = await expect<IssueDetail>(
          await request(`/issues/${progress.id}/close`, {
            user: citizen.id,
            method: "POST",
            body: "{}",
          }),
          200,
        );
        assert.equal(ended.history[0].previousStatus, "IN_PROGRESS");
        assert.equal(ended.history[0].status, "CLOSED");
        const defaultList = await expect<Page<Issue>>(
          await request("/issues?search=" + nonce, { user: citizen.id }),
          200,
        );
        assert(defaultList.items.every((item) => item.status !== "CLOSED"));
        assert(
          defaultList.items.some(
            (item) => item.id === fixtureId && item.status === "RESOLVED",
          ),
        );
        const defaultMap = await expect<IssueMap>(
          await request("/issues/map?search=" + nonce, { user: citizen.id }),
          200,
        );
        assert(defaultMap.points.every((item) => item.status !== "CLOSED"));
        const all = await expect<Page<Issue>>(
          await request("/issues?status=ALL&search=" + nonce, {
            user: citizen.id,
          }),
          200,
        );
        assert.equal(all.items.length, 4);
        assert(all.items.some((item) => item.id === report.id));
        assert(all.items.some((item) => item.id === progress.id));
        const allMap = await expect<IssueMap>(
          await request("/issues/map?status=ALL&search=" + nonce, {
            user: citizen.id,
          }),
          200,
        );
        assert(allMap.points.some((item) => item.id === report.id));
        const own = await expect<Page<Issue>>(
          await request("/issues?mine=true&search=" + nonce, {
            user: second.id,
          }),
          200,
        );
        assert(
          own.items.some(
            (item) => item.id === report.id && item.status === "CLOSED",
          ),
        );
        const metrics = await expect<Metrics>(
          await request("/metrics", { user: citizen.id }),
          200,
        );
        assert.equal(metrics.closed, baseline.closed + 2);
        assert.equal(metrics.total, baseline.total + 2);
        assert.equal(
          metrics.total,
          metrics.open + metrics.inProgress + metrics.resolved + metrics.closed,
        );
      },
    );

    await suite.test(
      "list and map pagination cover 52 Oracle records without omission",
      async () => {
        await withConnection(pool, (connection) =>
          transaction(connection, async () => {
            for (let index = 0; index < 52; index += 1) {
              const key = randomUUID();
              keys.push(key);
              await insertIssue(
                connection,
                citizen.id,
                issueInput.parse(draft("Pagination " + nonce + " " + index)),
                key,
                null,
              );
            }
          }),
        );
        const seen = new Set<number>();
        let offset: number | null = 0;
        for (const expectedSize of [15, 15, 15, 7]) {
          const page: Page<Issue> = await expect(
            await request(
              "/issues?search=Pagination%20" +
                nonce +
                "&limit=15&offset=" +
                offset,
              { user: citizen.id },
            ),
            200,
          );
          assert.equal(page.items.length, expectedSize);
          for (const issue of page.items) {
            assert(
              !seen.has(issue.id),
              "A report appeared in more than one page",
            );
            seen.add(issue.id);
          }
          offset = page.nextOffset;
        }
        assert.equal(seen.size, 52);
        const firstMap = await expect<IssueMap>(
          await request("/issues/map?search=Pagination%20" + nonce, {
            user: citizen.id,
          }),
          200,
        );
        assert.equal(firstMap.points.length, 50);
        assert.equal(firstMap.nextOffset, 50);
        const lastMap = await expect<IssueMap>(
          await request(
            "/issues/map?search=Pagination%20" + nonce + "&offset=50",
            { user: citizen.id },
          ),
          200,
        );
        assert.equal(lastMap.points.length, 2);
        assert.equal(lastMap.nextOffset, null);
        assert.equal(
          new Set([...firstMap.points, ...lastMap.points].map(({ id }) => id))
            .size,
          52,
        );
        assert.equal(offset, null);
      },
    );

    await suite.test(
      "pool release, degraded health and persistence after restarting the API",
      async () => {
        assert.equal(pool.connectionsInUse, 0);
        await pool.close();
        assert.deepEqual(await expect(await request("/health"), 503), {
          process: "up",
          database: "down",
        });
        await close(server);

        pool = await openPool();
        ({ server, url } = await listen(pool));
        const persisted = await expect<IssueDetail>(
          await request("/issues/" + fixtureId, { user: citizen.id }),
          200,
        );
        assert.equal(persisted.id, fixtureId);
        assert.equal(persisted.history[0].status, "RESOLVED");
        assert.equal(persisted.hasPhoto, true);
        assert.equal(pool.connectionsInUse, 0);
      },
    );
  } finally {
    await close(server);
    await withConnection(pool, (connection) =>
      transaction(connection, async () => {
        for (const key of keys) {
          const [issue] = await rows<{ id: number; locationId: number }>(
            connection,
            'SELECT id AS "id", location_id AS "locationId" FROM issue WHERE request_key = :key AND is_sample = 0',
            { key },
          );
          if (!issue) continue;
          const { id, locationId } = issue;
          await connection.execute(
            "DELETE FROM issue_confirmation WHERE issue_id = :id",
            { id },
          );
          await connection.execute(
            "DELETE FROM issue_status_history WHERE issue_id = :id",
            { id },
          );
          await connection.execute("DELETE FROM issue WHERE id = :id", { id });
          await connection.execute(
            "DELETE FROM issue_location WHERE id = :locationId",
            { locationId },
          );
        }
        for (const email of emails) {
          await connection.execute(
            "DELETE FROM app_user WHERE email = :email",
            { email },
          );
        }
      }),
    ).finally(() => pool.close());
  }
});
