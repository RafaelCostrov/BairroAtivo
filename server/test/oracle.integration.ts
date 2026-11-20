import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  health,
  openPool,
  rows,
  verifyPackage,
  withConnection,
} from "../src/database.ts";

test("Oracle Thin session uses BAIRROATIVO in FREEPDB1 and executes the PL/SQL suite", async () => {
  const pool = await openPool();
  try {
    await withConnection(pool, async (connection) => {
      assert.deepEqual(await health(connection), {
        schema: "BAIRROATIVO",
        container: "FREEPDB1",
      });
      assert.equal(connection.thin, true);
      await verifyPackage(connection);
      await connection.execute(
        await readFile(
          new URL("../../database/test.sql", import.meta.url),
          "utf8",
        ),
      );
    });
    await withConnection(pool, async (connection) => {
      const [leftovers] = await rows<{ total: number }>(
        connection,
        "SELECT count(*) AS \"total\" FROM issue WHERE title = 'Direct Oracle test'",
      );
      assert.equal(leftovers.total, 0);
    });
    assert.equal(pool.connectionsInUse, 0);
  } finally {
    await pool.close();
  }
});
