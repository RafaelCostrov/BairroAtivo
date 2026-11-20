import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import oracledb from "oracledb";
import type { Connection } from "oracledb";
import type { AuthSession, UserProfile } from "@bairroativo/shared";
import { oracleError, rows, transaction } from "./database.ts";
import { ApiError } from "./errors.ts";

const lifetimeDays = 14;
const saltBytes = 16;
const hashBytes = 64;
const scryptOptions = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const profileColumns =
  'id AS "id", display_name AS "name", email AS "email", role AS "role"';

function passwordKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, hashBytes, scryptOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

async function passwordHash(password: string) {
  const salt = randomBytes(saltBytes);
  return (
    salt.toString("hex") +
    ":" +
    (await passwordKey(password, salt)).toString("hex")
  );
}

async function matchesPassword(password: string, stored?: string) {
  const [saltHex, keyHex] = stored?.split(":") ?? [];
  const salt = saltHex ? Buffer.from(saltHex, "hex") : Buffer.alloc(saltBytes);
  const key = keyHex ? Buffer.from(keyHex, "hex") : Buffer.alloc(hashBytes);
  const candidate = await passwordKey(password, salt);
  return (
    key.length === candidate.length &&
    timingSafeEqual(key, candidate) &&
    Boolean(stored)
  );
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest();
}

export function bearerToken(header?: string) {
  const token = /^Bearer ([-\w]{43})$/i.exec(header ?? "")?.[1];
  if (!token) throw new ApiError(401, "INVALID_IDENTITY");
  return token;
}

async function startSession(
  connection: Connection,
  user: UserProfile,
): Promise<AuthSession> {
  const token = randomBytes(32).toString("base64url");
  await connection.execute(
    "DELETE FROM app_session WHERE expires_at <= systimestamp",
  );
  await connection.execute(
    "INSERT INTO app_session (token_hash, user_id, expires_at) VALUES (:hash, :id, systimestamp + numtodsinterval(:days, 'DAY'))",
    { hash: hashToken(token), id: user.id, days: lifetimeDays },
  );
  return { token, user };
}

export async function register(
  connection: Connection,
  input: { name: string; email: string; password: string },
) {
  const { name, email, password } = input;
  const hash = await passwordHash(password);
  return transaction(connection, async () => {
    let id: number | undefined;
    try {
      const result = await connection.execute<{ id: number[] }>(
        "INSERT INTO app_user (display_name, email, password_hash, role) VALUES (:name, :email, :hash, 'CITIZEN') RETURNING id INTO :id",
        {
          name,
          email,
          hash,
          id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
      );
      id = result.outBinds?.id[0];
    } catch (error) {
      if (oracleError(error)?.number === 1)
        throw new ApiError(409, "EMAIL_IN_USE");
      throw error;
    }
    if (id == null) throw new Error("Missing registered user ID");
    return startSession(connection, { id, name, email, role: "CITIZEN" });
  });
}

export async function login(
  connection: Connection,
  email: string,
  password: string,
) {
  const [account] = await rows<UserProfile & { passwordHash: string }>(
    connection,
    `SELECT ${profileColumns}, password_hash AS "passwordHash" FROM app_user WHERE email = :email`,
    { email },
  );
  if (!(await matchesPassword(password, account?.passwordHash)) || !account) {
    throw new ApiError(401, "INVALID_CREDENTIALS");
  }
  const { id, name, role } = account;
  return transaction(connection, () =>
    startSession(connection, { id, name, email, role }),
  );
}

export async function authenticatedUser(connection: Connection, token: string) {
  const [user] = await rows<UserProfile>(
    connection,
    `SELECT ${profileColumns} FROM app_user
      WHERE id = (SELECT user_id FROM app_session WHERE token_hash = :hash AND expires_at > systimestamp)
        AND email IS NOT NULL AND password_hash IS NOT NULL`,
    { hash: hashToken(token) },
  );
  if (!user) throw new ApiError(401, "INVALID_IDENTITY");
  return user;
}

export async function logout(connection: Connection, token: string) {
  await connection.execute("DELETE FROM app_session WHERE token_hash = :hash", {
    hash: hashToken(token),
  });
}

export async function updateProfile(
  connection: Connection,
  user: UserProfile,
  name: string,
) {
  await connection.execute(
    "UPDATE app_user SET display_name = :name WHERE id = :id",
    {
      name,
      id: user.id,
    },
  );
  return { ...user, name };
}
