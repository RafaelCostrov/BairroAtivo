import { once } from "node:events";
import { createApp } from "./app.ts";
import { apiConfig } from "./config.ts";
import {
  health,
  openPool,
  oracleError,
  rows,
  verifyPackage,
  withConnection,
} from "./database.ts";

async function main() {
  const { host, port } = apiConfig();
  const pool = await openPool();
  try {
    await withConnection(pool, async (connection) => {
      await health(connection);
      await verifyPackage(connection);
      const applied = await rows(
        connection,
        "SELECT version FROM app_schema_migration WHERE version = '008_author_closure.sql' AND applied_at IS NOT NULL",
      );
      if (!applied.length)
        throw new Error("Run npm run db:migrate before starting the API");
    });
    const server = createApp(pool, host).listen(port, host);
    try {
      await once(server, "listening");
    } catch (error) {
      if (oracleError(error)?.code === "EADDRINUSE") {
        throw new Error(
          `EADDRINUSE: ${host}:${port} is already in use. Check whether BairroAtivo is already running, or set API_PORT to a free port.`,
          { cause: error },
        );
      }
      throw error;
    }
    console.log(`BairroAtivo API listening on http://${host}:${port}/api/v1`);

    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      try {
        const drained = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        const timeout = setTimeout(() => server.closeAllConnections(), 8000);
        timeout.unref();
        try {
          await drained;
        } finally {
          clearTimeout(timeout);
          await pool.close(5);
        }
      } catch {
        console.error("API shutdown failed");
        process.exitCode = 1;
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    await pool.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(
    "API startup failed",
    oracleError(error)?.code ??
      (error instanceof Error ? error.message : "Unknown error"),
  );
  process.exitCode = 1;
});
