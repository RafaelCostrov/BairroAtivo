import type { Connection } from "oracledb";
import { credentialsInput } from "@bairroativo/shared";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  health,
  openPool,
  oracleError,
  rows,
  transaction,
  verifyPackage,
  withConnection,
} from "./database.ts";

const database = new URL("../../database/", import.meta.url);
const migrationFolder = new URL("migrations/", database);

async function inspect(connection: Connection) {
  console.log(await health(connection));
  console.table(
    await rows(
      connection,
      "SELECT object_name, object_type, status FROM user_objects ORDER BY object_type, object_name",
    ),
  );
  console.table(
    await rows(
      connection,
      "SELECT privilege FROM session_privs ORDER BY privilege",
    ),
  );
  console.table(
    await rows(
      connection,
      "SELECT u.default_tablespace, q.tablespace_name, q.bytes, q.max_bytes FROM user_users u LEFT JOIN user_ts_quotas q ON q.tablespace_name = u.default_tablespace",
    ),
  );
}

async function migrate(connection: Connection) {
  await connection.execute(`CREATE TABLE IF NOT EXISTS app_schema_migration (
    version VARCHAR2(100 CHAR) PRIMARY KEY,
    checksum VARCHAR2(64 CHAR) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE
  ) SEGMENT CREATION IMMEDIATE`);
  const migrations = (await readdir(migrationFolder))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const managedObjects = new Set<string>();

  for (const version of migrations) {
    const script = await readFile(new URL(version, migrationFolder), "utf8");
    const checksum = createHash("sha256").update(script).digest("hex");
    const statements = script
      .split(/^\/\s*$/m)
      .map((statement) => statement.trim())
      .filter(Boolean);
    const objectNames = new Set(
      statements.flatMap((statement) => {
        if (/^(BEGIN|DECLARE)\b/i.test(statement)) return [];
        const object = statement.match(
          /^CREATE (?:TABLE IF NOT EXISTS|INDEX IF NOT EXISTS|OR REPLACE PACKAGE(?: BODY)?) (\w+)/i,
        )?.[1];
        if (!object)
          throw new Error("Unexpected migration statement in " + version);
        return [object.toUpperCase()];
      }),
    );
    const newObjects = [...objectNames].filter(
      (name) => !managedObjects.has(name),
    );
    for (const name of objectNames) managedObjects.add(name);
    const [saved] = await rows<{ checksum: string; applied: number }>(
      connection,
      'SELECT checksum AS "checksum", CASE WHEN applied_at IS NOT NULL THEN 1 ELSE 0 END AS "applied" FROM app_schema_migration WHERE version = :version',
      { version },
    );
    if (saved && saved.checksum !== checksum)
      throw new Error("Migration checksum changed: " + version);
    if (saved?.applied) continue;

    if (!saved) {
      const existing = await rows<{ name: string }>(
        connection,
        'SELECT object_name AS "name" FROM user_objects',
      );
      const conflicts = existing
        .filter(({ name }) => newObjects.includes(name))
        .map(({ name }) => name);
      if (conflicts.length)
        throw new Error(
          "Existing Oracle objects require review: " + conflicts.join(", "),
        );
      await connection.execute(
        "INSERT INTO app_schema_migration (version, checksum) VALUES (:version, :checksum)",
        { version, checksum },
        { autoCommit: true },
      );
    }

    for (const statement of statements) await connection.execute(statement);
    if (objectNames.has("PKG_ISSUES")) await verifyPackage(connection);
    await connection.execute(
      "UPDATE app_schema_migration SET applied_at = systimestamp WHERE version = :version",
      { version },
      { autoCommit: true },
    );
    console.log("Applied " + version);
  }
  await verifyPackage(connection);
}

async function main() {
  const pool = await openPool();
  try {
    await withConnection(pool, async (connection) => {
      await health(connection);
      switch (process.argv[2]) {
        case "inspect":
          return inspect(connection);
        case "migrate":
          return migrate(connection);
        case "seed":
          await verifyPackage(connection);
          await transaction(connection, async () => {
            await connection.execute(
              await readFile(new URL("seed.sql", database), "utf8"),
            );
          });
          console.log("Issue categories available");
          return;
        case "role": {
          const email = credentialsInput.shape.email.parse(process.argv[3]);
          const role =
            process.argv[4] === "agent"
              ? "OPERATOR"
              : process.argv[4] === "resident"
                ? "CITIZEN"
                : undefined;
          if (!role)
            throw new Error(
              "Usage: npm run user:role -- <email> agent|resident",
            );
          await transaction(connection, async () => {
            const result = await connection.execute(
              "UPDATE app_user SET role = :role WHERE email = :email AND password_hash IS NOT NULL",
              { role, email },
            );
            if (result.rowsAffected !== 1)
              throw new Error("Registered account not found");
          });
          console.log("Account role updated");
          return;
        }
        default:
          throw new Error("Expected inspect, migrate, seed or role");
      }
    });
  } finally {
    await pool.close();
  }
}

main().catch((error: unknown) => {
  const code = oracleError(error)?.code;
  console.error(
    code ??
      (error instanceof Error ? error.message : "Database command failed"),
  );
  process.exitCode = 1;
});
