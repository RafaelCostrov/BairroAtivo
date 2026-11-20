import {
  deviceAddress,
  mergeDeviceLocation,
  normalizePlace,
  normalizeState,
} from "@bairroativo/shared";
import type { AddressMatch } from "@bairroativo/shared";

export async function resolveLocation(
  point: Pick<AddressMatch, "latitude" | "longitude">,
  candidate: AddressMatch | undefined,
  search: () => Promise<AddressMatch[]>,
  check: (
    code: string | null,
    city?: string | null,
    state?: string | null,
  ) => Promise<string | null>,
): Promise<AddressMatch> {
  let primary = candidate ? { ...candidate, ...point } : deviceAddress(point);
  const matches = await search().catch(() => []);
  const fallback = matches[0];
  if (!fallback?.city || !fallback.state)
    return { ...primary, postalCode: null };
  if (
    (primary.city &&
      normalizePlace(primary.city) !== normalizePlace(fallback.city)) ||
    (primary.state &&
      normalizeState(primary.state) !== normalizeState(fallback.state))
  ) {
    primary = { ...fallback, ...point };
  }
  primary = {
    ...primary,
    city: fallback.city,
    state: fallback.state,
    postalCode: await check(primary.postalCode, fallback.city, fallback.state),
  };
  if (
    primary.postalCode &&
    primary.neighborhood !== "Bairro indisponível" &&
    primary.address !== "Endereço indisponível"
  )
    return primary;
  const verified = {
    ...fallback,
    postalCode: await check(fallback.postalCode, fallback.city, fallback.state),
  };
  return mergeDeviceLocation(point, primary, verified);
}
