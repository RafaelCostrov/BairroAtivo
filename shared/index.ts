import { z } from "zod";

export const severities = ["LOW", "MEDIUM", "HIGH"] as const;
export const statuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export const orders = ["recent", "priority"] as const;
export const photoLimit = 5 * 1024 * 1024;
export const issuePageSize = 15;

export const issueDateRange = z
  .object({
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .refine(
    ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
    {
      path: ["endDate"],
    },
  );

export const coordinateInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const selectedLocationInput = coordinateInput.extend({
  label: z.string().trim().min(1).max(500),
  neighborhood: z.string().trim().min(2).max(80),
  address: z.string().trim().min(4).max(200),
  postalCode: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  state: z.string().trim().min(1).max(80).nullable().optional(),
});
export type AddressMatch = z.infer<typeof selectedLocationInput>;

export type Severity = (typeof severities)[number];
export type Status = (typeof statuses)[number];
export type IssueStatusFilter = Status | "ALL";

export function nextStatus(status: Status): Status | undefined {
  return status === "OPEN"
    ? "IN_PROGRESS"
    : status === "IN_PROGRESS"
      ? "RESOLVED"
      : undefined;
}

export const postalCodeInput = z
  .string()
  .trim()
  .regex(/^(?:\d{5}-?\d{3})?$/)
  .transform((value) => value.replace("-", "") || undefined);

export const profileInput = z.strictObject({
  name: z.string().trim().min(2).max(80),
});
export const credentialsInput = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(128),
});
export const registrationInput = credentialsInput.extend({
  ...profileInput.shape,
  password: z.string().min(8).max(128),
});

export const issueInput = z.object({
  categoryId: z.number().int().positive(),
  title: z.string().trim().min(5).max(100),
  description: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => value || undefined)
    .optional(),
  severity: z.enum(severities),
  neighborhood: z.string().trim().min(2).max(80),
  address: z.string().trim().min(4).max(200),
  postalCode: postalCodeInput.optional(),
  ...coordinateInput.shape,
});

export type IssueInput = z.infer<typeof issueInput>;
export type Category = { id: number; code: string; name: string };
export type UserSummary = {
  id: number;
  name: string;
  role: "CITIZEN" | "OPERATOR";
};
export type UserProfile = UserSummary & { email: string };
export type AuthSession = { token: string; user: UserProfile };

export type Issue = {
  id: number;
  category: Category;
  author: UserSummary;
  title: string;
  description: string | null;
  severity: Severity;
  status: Status;
  neighborhood: string;
  address: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  confirmationCount: number;
  confirmed: boolean;
  priorityScore: number;
  hasPhoto: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HistoryEntry = {
  id: number;
  previousStatus: Status | null;
  status: Status;
  actorName: string;
  note: string | null;
  createdAt: string;
};

export type IssueDetail = Issue & {
  severityPoints: number;
  history: HistoryEntry[];
};
export type Page<T> = { items: T[]; nextOffset: number | null };
export type IssueMapPoint = Pick<
  Issue,
  "id" | "title" | "status" | "neighborhood"
> & {
  latitude: number;
  longitude: number;
};
export type IssueMap = {
  points: IssueMapPoint[];
  truncated: boolean;
  nextOffset: number | null;
  unlocated: { id: number; title: string; neighborhood: string }[];
};
export type Metrics = {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  categories: { id: number; name: string; count: number }[];
  neighborhoods: { name: string; count: number }[];
};

export type ApiErrorCode =
  | "INVALID_INPUT"
  | "INVALID_IDENTITY"
  | "INVALID_CREDENTIALS"
  | "EMAIL_IN_USE"
  | "TOO_MANY_ATTEMPTS"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ALREADY_CONFIRMED"
  | "RESOLVED"
  | "CLOSED"
  | "INVALID_TRANSITION"
  | "REQUEST_CONFLICT"
  | "INVALID_PHOTO"
  | "PHOTO_TOO_LARGE"
  | "UNAVAILABLE"
  | "INTERNAL";

export function issueDateText(value?: string) {
  return value
    ? value.slice(8, 10) + "/" + value.slice(5, 7) + "/" + value.slice(0, 4)
    : "";
}

export function maskIssueDate(text: string) {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter(Boolean)
    .join("/");
}

function issueDateValue(text: string) {
  const value = text.trim();
  if (!value) return undefined;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? match[3] + "-" + match[2] + "-" + match[1] : value;
}

export function parseIssueDateRange(start: string, end: string) {
  return issueDateRange.safeParse({
    startDate: issueDateValue(start),
    endDate: issueDateValue(end),
  });
}

type Point = { latitude: number; longitude: number };
type DeviceAddress = {
  district?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  name?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

export function deviceAddress(
  point: Point,
  address?: DeviceAddress,
): AddressMatch {
  const street = [address?.street || address?.name, address?.streetNumber]
    .filter(Boolean)
    .join(", ");
  const line = [
    ...new Set([street, address?.city, address?.region].filter(Boolean)),
  ].join(", ");
  const postalCode = postalCodeInput.safeParse(address?.postalCode ?? "");
  return {
    ...coordinateInput.parse(point),
    label: (line || "Localização do aparelho").slice(0, 500),
    neighborhood:
      address?.district && address.district.trim().length >= 2
        ? address.district.trim().slice(0, 80)
        : "Bairro indisponível",
    address: line.length >= 4 ? line.slice(0, 200) : "Endereço indisponível",
    postalCode: postalCode.success ? (postalCode.data ?? null) : null,
    city: address?.city?.trim() || null,
    state: address?.region?.trim() || null,
  };
}

export function mergeDeviceLocation(
  point: Point,
  primary: AddressMatch,
  secondary: unknown,
) {
  const parsed = selectedLocationInput.safeParse(secondary);
  if (!parsed.success) return { ...primary, ...point };
  if (
    primary.city &&
    parsed.data.city &&
    normalizePlace(primary.city) !== normalizePlace(parsed.data.city)
  )
    return { ...primary, ...point };
  if (
    primary.state &&
    parsed.data.state &&
    normalizeState(primary.state) !== normalizeState(parsed.data.state)
  )
    return { ...primary, ...point };
  if (primary.address === "Endereço indisponível")
    return { ...parsed.data, ...point };
  return {
    ...primary,
    ...point,
    neighborhood:
      primary.neighborhood === "Bairro indisponível"
        ? parsed.data.neighborhood
        : primary.neighborhood,
    address:
      primary.address === "Endereço indisponível"
        ? parsed.data.address
        : primary.address,
    label:
      primary.address === "Endereço indisponível"
        ? parsed.data.label
        : primary.label,
    postalCode:
      primary.postalCode ??
      (primary.city && parsed.data.city ? parsed.data.postalCode : null),
    city: primary.city ?? parsed.data.city,
    state: primary.state ?? parsed.data.state,
  };
}

export function normalizePlace(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function normalizeState(value: string) {
  const states = [
    ["AC", "Acre"],
    ["AL", "Alagoas"],
    ["AP", "Amapá"],
    ["AM", "Amazonas"],
    ["BA", "Bahia"],
    ["CE", "Ceará"],
    ["DF", "Distrito Federal"],
    ["ES", "Espírito Santo"],
    ["GO", "Goiás"],
    ["MA", "Maranhão"],
    ["MT", "Mato Grosso"],
    ["MS", "Mato Grosso do Sul"],
    ["MG", "Minas Gerais"],
    ["PA", "Pará"],
    ["PB", "Paraíba"],
    ["PR", "Paraná"],
    ["PE", "Pernambuco"],
    ["PI", "Piauí"],
    ["RJ", "Rio de Janeiro"],
    ["RN", "Rio Grande do Norte"],
    ["RS", "Rio Grande do Sul"],
    ["RO", "Rondônia"],
    ["RR", "Roraima"],
    ["SC", "Santa Catarina"],
    ["SP", "São Paulo"],
    ["SE", "Sergipe"],
    ["TO", "Tocantins"],
  ];
  const normalized = normalizePlace(value);
  return (
    states.find(
      ([code, name]) =>
        normalizePlace(code) === normalized ||
        normalizePlace(name) === normalized,
    )?.[0] ?? normalized
  );
}
