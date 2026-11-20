import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deviceAddress,
  mergeDeviceLocation,
  issueInput,
  maskIssueDate,
  selectedLocationInput,
} from "@bairroativo/shared";

const point = { latitude: -23.5557603, longitude: -46.6626616 };

test("numeric date entry inserts separators and supports partial edits", () => {
  assert.equal(maskIssueDate("18112026"), "18/11/2026");
  assert.equal(maskIssueDate("18/11/2026"), "18/11/2026");
  assert.equal(maskIssueDate("181"), "18/1");
  assert.equal(maskIssueDate("18/"), "18");
  assert.equal(maskIssueDate("abc"), "");
  assert.equal(maskIssueDate("181120260"), "18/11/2026");
});

test("native reverse geocoding fills Brazilian address attributes", () => {
  const result = deviceAddress(point, {
    district: "Consolação",
    street: "Avenida Paulista",
    streetNumber: "1578",
    city: "São Paulo",
    region: "SP",
    postalCode: "01310-200",
  });
  assert.equal(result.neighborhood, "Consolação");
  assert.equal(result.address, "Avenida Paulista, 1578, São Paulo, SP");
  assert.equal(result.postalCode, "01310200");
  assert.equal(selectedLocationInput.safeParse(result).success, true);
  assert.equal(result.latitude, point.latitude);
});

test("old coordinate-only responses cannot erase safe device location fields", () => {
  const result = mergeDeviceLocation(point, deviceAddress(point), { ...point });
  assert.equal(result.neighborhood, "Bairro indisponível");
  assert.equal(result.address, "Endereço indisponível");
  assert.equal(result.postalCode, null);
  assert.equal(
    issueInput.safeParse({
      categoryId: 1,
      title: "Teste de localização",
      severity: "MEDIUM",
      ...result,
      postalCode: result.postalCode ?? "",
    }).success,
    true,
  );
  assert.equal(selectedLocationInput.safeParse({ ...point }).success, false);
});

test("server metadata supplements native results without moving the GPS point", () => {
  const primary = deviceAddress(point, {
    district: "Consolação",
    street: "Avenida Paulista",
    city: "São Paulo",
    region: "SP",
  });
  const result = mergeDeviceLocation(point, primary, {
    latitude: -23.556,
    longitude: -46.663,
    label: "Local próximo",
    neighborhood: "Bela Vista",
    address: "Outro endereço",
    postalCode: "01310200",
    city: "São Paulo",
    state: "São Paulo",
  });
  assert.equal(result.neighborhood, "Consolação");
  assert.equal(result.address, primary.address);
  assert.equal(result.postalCode, "01310200");
  assert.equal(result.latitude, point.latitude);
  assert.equal(result.longitude, point.longitude);
});

test("postal validation rejects Marapoama's municipality for a Guarulhos location", async () => {
  const { matchingPostalCode } = await import("../src/postal-codes.ts");
  const record = { cep: "15845-000", localidade: "Marapoama", uf: "SP" };
  assert.equal(matchingPostalCode(record, "15845000", "Guarulhos", "SP"), null);
  assert.equal(matchingPostalCode(record, "15845000", "Marapoama", "RJ"), null);
  assert.equal(matchingPostalCode(record, "15845000", null, "SP"), null);
  assert.equal(
    matchingPostalCode({ erro: true }, "15845000", "Guarulhos", "SP"),
    null,
  );
  assert.equal(
    matchingPostalCode(
      { cep: "01001-000", localidade: "São Paulo", uf: "SP" },
      "01001000",
      "Sao Paulo",
      "São Paulo",
    ),
    "01001000",
  );
});

test("GPS resolution replaces a wrong-city postcode while retaining condominium address and coordinates", async () => {
  const { resolveLocation } = await import("../src/resolve-location.ts");
  const { matchingPostalCode } = await import("../src/postal-codes.ts");
  const primary = deviceAddress(point, {
    street: "Rua Um",
    streetNumber: "60",
    district: "Condomínio de teste",
    city: "Guarulhos",
    region: "SP",
    postalCode: "15845-000",
  });
  const fallback = {
    ...primary,
    address: "Via pública próxima, Guarulhos",
    postalCode: "07010000",
  };
  const check = async (
    code: string | null,
    city?: string | null,
    state?: string | null,
  ) =>
    matchingPostalCode(
      {
        cep: code,
        localidade: code === "15845000" ? "Marapoama" : "Guarulhos",
        uf: "SP",
      },
      code ?? "",
      city,
      state,
    );
  const result = await resolveLocation(
    point,
    primary,
    async () => [fallback],
    check,
  );
  assert.equal(result.postalCode, "07010000");
  assert.equal(result.address, primary.address);
  assert.equal(result.latitude, point.latitude);
  const mismatch = await resolveLocation(
    point,
    { ...primary, city: "Marapoama" },
    async () => [fallback],
    check,
  );
  assert.equal(mismatch.postalCode, "07010000");
  assert.equal(mismatch.city, "Guarulhos");
  assert.equal(mismatch.address, fallback.address);
  const combined = mergeDeviceLocation(
    point,
    { ...primary, postalCode: null },
    { ...fallback, city: "Marapoama", postalCode: "15845000" },
  );
  assert.equal(combined.postalCode, null);
  const unavailable = await resolveLocation(
    point,
    primary,
    async () => {
      throw new Error("offline");
    },
    async () => null,
  );
  assert.equal(unavailable.postalCode, null);
  assert.equal(unavailable.latitude, point.latitude);
});

test("reverse lookup ignores distant candidates even when they have a postcode", async () => {
  const { nearbyMatches } = await import("../src/geocoding.ts");
  const base = deviceAddress(point, { city: "São Paulo", region: "SP" });
  const close = {
    ...base,
    latitude: point.latitude + 0.0001,
    postalCode: null,
  };
  const far = {
    ...base,
    latitude: -21.25,
    longitude: -49.128,
    postalCode: "15845000",
  };
  assert.deepEqual(nearbyMatches(point, [far, close]), [close]);
});
