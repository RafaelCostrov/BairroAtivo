import oracledb from "oracledb";
import type { BindParameters, Connection, Pool, ResultSet } from "oracledb";
import { databaseConfig } from "./config.ts";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

export class DatabaseUnavailable extends Error {
  constructor() {
    super("Oracle is unavailable");
  }
}

export async function openPool() {
  return oracledb.createPool({
    ...databaseConfig(),
    poolMin: 1,
    poolMax: 6,
    poolIncrement: 1,
    queueTimeout: 4000,
  });
}

export async function withConnection<T>(
  pool: Pool,
  run: (connection: Connection) => Promise<T>,
) {
  let connection: Connection;
  try {
    connection = await pool.getConnection();
  } catch {
    throw new DatabaseUnavailable();
  }
  try {
    connection.callTimeout = 5000;
    return await run(connection);
  } finally {
    await connection.close();
  }
}

export async function transaction<T>(
  connection: Connection,
  run: () => Promise<T>,
  readOnly = false,
) {
  try {
    if (readOnly) await connection.execute("SET TRANSACTION READ ONLY");
    const result = await run();
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export async function rows<T>(
  connection: Connection,
  sql: string,
  binds: BindParameters = {},
) {
  return (await connection.execute<T>(sql, binds)).rows ?? [];
}

export async function health(connection: Connection) {
  const [session] = await rows<{ schema: string; container: string }>(
    connection,
    "SELECT user AS \"schema\", sys_context('USERENV', 'CON_NAME') AS \"container\" FROM dual",
  );
  if (session?.schema !== "BAIRROATIVO" || session.container !== "FREEPDB1") {
    throw new Error("Unexpected Oracle schema or container");
  }
  return session;
}

export async function verifyPackage(connection: Connection) {
  const invalid = await rows(
    connection,
    "SELECT object_name, object_type FROM user_objects WHERE status = 'INVALID'",
  );
  if (invalid.length) {
    const errors = await rows(
      connection,
      "SELECT name, type, line, position, text FROM user_errors ORDER BY name, type, sequence",
    );
    throw new Error(JSON.stringify({ invalid, errors }));
  }
  const [result] = await rows<{ valid: number }>(
    connection,
    "SELECT count(*) AS \"valid\" FROM user_objects WHERE object_name = 'PKG_ISSUES' AND object_type IN ('PACKAGE', 'PACKAGE BODY')",
  );
  if (result?.valid !== 2)
    throw new Error("Run the database migrations before starting the API");
}

export async function fetchCursor<T>(cursor: ResultSet<T>) {
  try {
    return await cursor.getRows();
  } finally {
    await cursor.close();
  }
}

export function oracleError(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  const number =
    "errorNum" in error && typeof error.errorNum === "number"
      ? error.errorNum
      : undefined;
  return { code, number };
}
