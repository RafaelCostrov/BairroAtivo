import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { isIPv4 } from "node:net";

export function databaseConfig() {
  const path = new URL("../.env", import.meta.url);
  let env: NodeJS.Dict<string>;
  try {
    env = parseEnv(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Could not read server/.env");
  }
  const { DB_USER, DB_PASSWORD, DB_CONNECT_STRING } = env;
  if (!DB_USER || !DB_PASSWORD || !DB_CONNECT_STRING) {
    throw new Error(
      "server/.env requires DB_USER, DB_PASSWORD and DB_CONNECT_STRING",
    );
  }
  if (DB_USER.toUpperCase() !== "BAIRROATIVO") {
    throw new Error("The Oracle connection must use the BAIRROATIVO schema");
  }
  return {
    user: DB_USER,
    password: DB_PASSWORD,
    connectString: DB_CONNECT_STRING,
  };
}

export function isLocalAddress(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [first, second] = host.split(".").map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

export function apiConfig() {
  const env = parseEnv(
    readFileSync(new URL("../.env", import.meta.url), "utf8"),
  );
  const host = process.env.API_HOST ?? env.API_HOST ?? "127.0.0.1";
  const port = Number(process.env.API_PORT ?? env.API_PORT ?? "3000");
  if (!isLocalAddress(host))
    throw new Error("API_HOST must be a loopback or private IPv4 address");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid API_PORT");
  return { host, port };
}
