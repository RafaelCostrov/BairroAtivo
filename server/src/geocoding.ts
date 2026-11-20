import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { setTimeout } from "node:timers/promises";
import type { Pool } from "oracledb";
import { z } from "zod";
import { postalCodeInput, selectedLocationInput } from "@bairroativo/shared";
import type { AddressMatch } from "@bairroativo/shared";
import { rows, withConnection } from "./database.ts";
import { ApiError } from "./errors.ts";

const featureCollection = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([
          z.number().min(-180).max(180),
          z.number().min(-90).max(90),
        ]),
      }),
      properties: z.object({
        name: z.string().optional(),
        street: z.string().optional(),
        housenumber: z.string().optional(),
        district: z.string().optional(),
        locality: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),
        countrycode: z.string().optional(),
      }),
    }),
  ),
});
const cachedMatches = z.array(selectedLocationInput).max(3);

export function addressMatches(value: unknown): AddressMatch[] {
  return featureCollection
    .parse(value)
    .features.filter(
      ({ properties }) => properties.countrycode?.toUpperCase() === "BR",
    )
    .slice(0, 3)
    .map(({ geometry, properties: p }) => {
      const label = [
        ...new Set(
          [
            p.name,
            p.street,
            p.housenumber,
            p.district,
            p.city,
            p.state,
            p.postcode,
          ].filter(Boolean),
        ),
      ]
        .join(", ")
        .slice(0, 500);
      const postal = postalCodeInput.safeParse(p.postcode ?? "");
      return {
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1],
        label,
        neighborhood: (p.district || p.locality || "Bairro indisponível").slice(
          0,
          80,
        ),
        address: (
          [
            ...new Set(
              [
                [p.street || p.name, p.housenumber].filter(Boolean).join(", "),
                p.city,
                p.state,
              ].filter(Boolean),
            ),
          ].join(", ") || label
        ).slice(0, 200),
        postalCode: postal.success ? (postal.data ?? null) : null,
        city: p.city ?? null,
        state: p.state ?? null,
      };
    })
    .filter((match) => selectedLocationInput.safeParse(match).success);
}

export function createAddressSearch(pool: Pool) {
  const env = parseEnv(
    readFileSync(new URL("../.env", import.meta.url), "utf8"),
  );
  const endpoint = new URL(
    process.env.GEOCODER_URL ??
      env.GEOCODER_URL ??
      "https://photon.komoot.io/api/",
  );
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("GEOCODER_URL must use HTTPS or loopback");
  }
  const pending = new Map<string, Promise<AddressMatch[]>>();
  let queue = Promise.resolve();
  let nextRequest = 0;
  let queued = 0;

  async function search(
    query: string,
    hash: Buffer,
    coordinates?: { latitude: number; longitude: number },
  ) {
    const cached = await withConnection(pool, (connection) =>
      rows<{ result: string }>(
        connection,
        'SELECT result_json AS "result" FROM address_search_cache WHERE query_hash = :hash AND expires_at > systimestamp',
        { hash },
      ),
    );
    if (cached[0]) {
      let value: unknown;
      try {
        value = JSON.parse(cached[0].result);
      } catch {
        value = null;
      }
      const parsed = cachedMatches.safeParse(value);
      if (parsed.success)
        return coordinates
          ? nearbyMatches(coordinates, parsed.data)
          : parsed.data;
    }
    if (queued >= 1) throw new ApiError(429, "TOO_MANY_ATTEMPTS");

    queued += 1;
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      await setTimeout(Math.max(0, nextRequest - Date.now()));
      nextRequest = Date.now() + 1100;
      const url = new URL(endpoint);
      if (coordinates) {
        url.pathname = url.pathname.replace(/\/api\/?$/, "/reverse");
        url.searchParams.set("lat", String(coordinates.latitude));
        url.searchParams.set("lon", String(coordinates.longitude));
        url.searchParams.set("radius", "0.5");
      } else {
        url.searchParams.set("q", query);
        url.searchParams.set("bbox", "-73.99,-33.75,-28.8,5.28");
        url.searchParams.set("countrycode", "BR");
      }
      url.searchParams.set("limit", "3");
      let matches: AddressMatch[];
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "BairroAtivo/1.0 (local community issue reporting)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Geocoding provider unavailable");
        matches = addressMatches(await response.json());
        if (coordinates) matches = nearbyMatches(coordinates, matches);
      } catch {
        throw new ApiError(503, "UNAVAILABLE");
      }
      await withConnection(pool, async (connection) => {
        await connection.execute(
          `MERGE INTO address_search_cache target
          USING (SELECT :hash query_hash FROM dual) source ON (target.query_hash = source.query_hash)
          WHEN MATCHED THEN UPDATE SET result_json = :result, expires_at = systimestamp + numtodsinterval(:days, 'DAY')
          WHEN NOT MATCHED THEN INSERT (query_hash, result_json, expires_at)
          VALUES (:hash, :result, systimestamp + numtodsinterval(:days, 'DAY'))`,
          {
            hash,
            result: JSON.stringify(matches),
            days: matches.length ? 30 : 1,
          },
          { autoCommit: true },
        );
      });
      return matches;
    } finally {
      queued -= 1;
      release();
    }
  }

  return (
    query: string,
    coordinates?: { latitude: number; longitude: number },
  ) => {
    const normalized = query
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("pt-BR");
    const hash = createHash("sha256")
      .update("v3:" + normalized)
      .digest();
    const key = hash.toString("hex");
    const existing = pending.get(key);
    if (existing) return existing;
    const result = search(normalized, hash, coordinates).finally(() =>
      pending.delete(key),
    );
    pending.set(key, result);
    return result;
  };
}

export function nearbyMatches(
  point: { latitude: number; longitude: number },
  matches: AddressMatch[],
) {
  const distance = (match: AddressMatch) => {
    const radians = Math.PI / 180;
    const a =
      Math.sin(((match.latitude - point.latitude) * radians) / 2) ** 2 +
      Math.cos(point.latitude * radians) *
        Math.cos(match.latitude * radians) *
        Math.sin(((match.longitude - point.longitude) * radians) / 2) ** 2;
    return (
      6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
    );
  };
  return matches
    .filter((match) => distance(match) <= 500)
    .sort((a, b) => distance(a) - distance(b));
}
