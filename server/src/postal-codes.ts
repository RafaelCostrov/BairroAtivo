import { createHash } from "node:crypto";
import type { Pool } from "oracledb";
import { z } from "zod";
import {
  normalizePlace,
  normalizeState,
  postalCodeInput,
} from "@bairroativo/shared";
import { rows, withConnection } from "./database.ts";

const postalRecord = z.object({
  cep: z.string(),
  localidade: z.string().min(1),
  uf: z.string().regex(/^[A-Z]{2}$/),
});

export function matchingPostalCode(
  value: unknown,
  code: string,
  city?: string | null,
  state?: string | null,
) {
  const parsed = postalRecord.safeParse(value);
  if (!parsed.success || !city || !state) return null;
  const postal = postalCodeInput.safeParse(parsed.data.cep);
  return postal.success &&
    postal.data === code &&
    normalizePlace(parsed.data.localidade) === normalizePlace(city) &&
    normalizeState(parsed.data.uf) === normalizeState(state)
    ? code
    : null;
}

export function createPostalCodeCheck(pool: Pool) {
  const pending = new Map<string, Promise<unknown>>();
  async function lookup(code: string) {
    const hash = createHash("sha256")
      .update("postal:v1:" + code)
      .digest();
    const cached = await withConnection(pool, (connection) =>
      rows<{ result: string }>(
        connection,
        'SELECT result_json AS "result" FROM address_search_cache WHERE query_hash = :hash AND expires_at > systimestamp',
        { hash },
      ),
    );
    if (cached[0]) {
      try {
        return JSON.parse(cached[0].result);
      } catch {
        return null;
      }
    }
    const response = await fetch(
      "https://viacep.com.br/ws/" + code + "/json/",
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!response.ok) return null;
    const parsed = postalRecord.safeParse(await response.json());
    const result = parsed.success ? parsed.data : null;
    await withConnection(pool, async (connection) => {
      await connection.execute(
        `MERGE INTO address_search_cache target
        USING (SELECT :hash query_hash FROM dual) source ON (target.query_hash = source.query_hash)
        WHEN MATCHED THEN UPDATE SET result_json = :result, expires_at = systimestamp + numtodsinterval(:days, 'DAY')
        WHEN NOT MATCHED THEN INSERT (query_hash, result_json, expires_at)
        VALUES (:hash, :result, systimestamp + numtodsinterval(:days, 'DAY'))`,
        { hash, result: JSON.stringify(result), days: result ? 30 : 1 },
        { autoCommit: true },
      );
    });
    return result;
  }
  return async (
    code: string | null,
    city?: string | null,
    state?: string | null,
  ) => {
    if (!code || !/^\d{8}$/.test(code) || !city || !state) return null;
    let result = pending.get(code);
    if (!result) {
      result = lookup(code)
        .catch(() => null)
        .finally(() => pending.delete(code));
      pending.set(code, result);
    }
    return matchingPostalCode(await result, code, city, state);
  };
}
