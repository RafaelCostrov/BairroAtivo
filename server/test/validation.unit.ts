import assert from "node:assert/strict";
import { test } from "node:test";
import { issueInput, nextStatus } from "@bairroativo/shared";
import { isLocalAddress } from "../src/config.ts";
import { mapError } from "../src/errors.ts";
import { listInput, parse, requestHash } from "../src/validation.ts";

const draft = {
  categoryId: 1,
  title: "  Dano no passeio  ",
  description: "Trecho com peças soltas junto à travessia.",
  severity: "HIGH",
  neighborhood: "Jardim Ipê",
  address: "Rua do Cedro, esquina",
  latitude: -23.5,
  longitude: -46.6,
};

test("issue input requires coordinates and accepts optional descriptions", () => {
  assert.equal(parse(issueInput, draft).title, "Dano no passeio");
  assert.equal(
    parse(issueInput, { ...draft, latitude: -23.5, longitude: -46.6 }).latitude,
    -23.5,
  );
  for (const invalid of [
    { title: "  " },
    { severity: "URGENT" },
    { latitude: undefined },
    { latitude: 91, longitude: 0 },
    { address: "abc" },
    { categoryId: 0 },
  ]) {
    assert.throws(() => parse(issueInput, { ...draft, ...invalid }), {
      code: "INVALID_INPUT",
    });
  }
});

test("list validation bounds pagination and accepts enumerated filters", () => {
  assert.equal(parse(listInput, { status: "ALL" }).status, "ALL");
  assert.equal(parse(listInput, { status: "CLOSED" }).status, "CLOSED");
  assert.deepEqual(
    parse(listInput, {
      category: "2",
      limit: "10",
      offset: "5",
      status: "OPEN",
      order: "priority",
      mine: "true",
    }),
    {
      category: 2,
      limit: 10,
      offset: 5,
      status: "OPEN",
      order: "priority",
      mine: "true",
    },
  );
  for (const invalid of [
    { limit: "51" },
    { offset: "-1" },
    { category: ["4", "5"] },
    { order: "DROP" },
    { mine: "yes" },
  ]) {
    assert.throws(() => parse(listInput, invalid), { code: "INVALID_INPUT" });
  }
});

test("shared status progression terminates at resolved", () => {
  assert.equal(nextStatus("OPEN"), "IN_PROGRESS");
  assert.equal(nextStatus("IN_PROGRESS"), "RESOLVED");
  assert.equal(nextStatus("RESOLVED"), undefined);
  assert.equal(nextStatus("CLOSED"), undefined);
});

test("request fingerprint uses normalized data and binary photo content", () => {
  const first = parse(issueInput, draft);
  assert.deepEqual(
    requestHash(first, null),
    requestHash(parse(issueInput, { ...draft, title: first.title }), null),
  );
  assert.notDeepEqual(
    requestHash(first, null),
    requestHash(first, { mime: "image/png", buffer: Buffer.from([0, 1]) }),
  );
  const photo = { mime: "image/png", buffer: Buffer.from([0, 1]) };
  assert.notDeepEqual(
    requestHash(first, photo),
    requestHash(first, { ...photo, buffer: Buffer.from([0, 2]) }),
  );
});

test("API accepts local IPv4 addresses and maps Oracle business errors", () => {
  for (const local of ["127.0.0.1", "192.168.1.10", "172.31.255.2", "10.0.0.3"])
    assert.equal(isLocalAddress(local), true);
  for (const other of ["0.0.0.0", "::", "172.32.0.1", "8.8.8.8", "example.org"])
    assert.equal(isLocalAddress(other), false);
  assert.equal(mapError({ errorNum: 20005 }).code, "RESOLVED");
  assert.equal(mapError({ errorNum: 20006 }).status, 409);
  assert.equal(mapError({ code: "NJS-503" }).status, 503);
});

test("date ranges validate calendar dates and chronological order", async () => {
  const { parseIssueDateRange: parseDateRange, issueDateText: dateText } =
    await import("@bairroativo/shared");
  assert.deepEqual(parseDateRange("18/11/2026", "18/11/2026").data, {
    startDate: "2026-11-18",
    endDate: "2026-11-18",
  });
  assert.equal(parseDateRange("29/02/2024", "").success, true);
  assert.equal(parseDateRange("29/02/2026", "").success, false);
  assert.equal(parseDateRange("31/04/2026", "").success, false);
  assert.equal(parseDateRange("19/11/2026", "18/11/2026").success, false);
  assert.equal(dateText("2026-11-18"), "18/11/2026");
  assert.equal(
    parse(listInput, { startDate: "2026-11-18", endDate: "2026-11-18" })
      .endDate,
    "2026-11-18",
  );
  assert.throws(() => parse(listInput, { endDate: "2026-13-01" }), {
    code: "INVALID_INPUT",
  });
});

test("address search keeps Brazilian points and rejects malformed provider coordinates", async () => {
  const { addressMatches } = await import("../src/geocoding.ts");
  const point = {
    geometry: { type: "Point", coordinates: [-46.65, -23.56] },
    properties: {
      name: "Avenida Paulista",
      city: "São Paulo",
      state: "São Paulo",
      countrycode: "BR",
    },
  };
  assert.deepEqual(addressMatches({ features: [point] }), [
    {
      latitude: -23.56,
      longitude: -46.65,
      label: "Avenida Paulista, São Paulo",
      neighborhood: "Bairro indisponível",
      address: "Avenida Paulista, São Paulo",
      postalCode: null,
      city: "São Paulo",
      state: "São Paulo",
    },
  ]);
  assert.deepEqual(
    addressMatches({
      features: [
        { ...point, properties: { ...point.properties, countrycode: "DE" } },
      ],
    }),
    [],
  );
  assert.throws(() =>
    addressMatches({
      features: [
        { ...point, geometry: { type: "Point", coordinates: [500, 0] } },
      ],
    }),
  );
});
