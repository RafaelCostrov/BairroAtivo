import { File } from "expo-file-system";
import { Platform } from "react-native";
import { selectedLocationInput } from "@bairroativo/shared";
import { z } from "zod";
import type {
  ApiErrorCode,
  Category,
  AuthSession,
  AddressMatch,
  IssueMap,
  UserProfile,
  Issue,
  IssueDetail,
  IssueInput,
  Metrics,
  Page,
  Status,
} from "@bairroativo/shared";

const base = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "android"
    ? "http://10.0.2.2:3000/api/v1"
    : "http://127.0.0.1:3000/api/v1")
).replace(/\/$/, "");

const messages: Record<ApiErrorCode, string> = {
  INVALID_INPUT: "Confira os dados informados.",
  INVALID_IDENTITY: "Sua sessão expirou. Entre novamente.",
  INVALID_CREDENTIALS: "E-mail ou senha incorretos.",
  EMAIL_IN_USE: "Já existe uma conta com este e-mail.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas. Aguarde um minuto e tente novamente.",
  FORBIDDEN: "Este perfil não pode executar esta operação.",
  NOT_FOUND: "O registro solicitado não foi encontrado.",
  ALREADY_CONFIRMED: "Seu perfil já confirmou esta ocorrência.",
  RESOLVED: "Ocorrências resolvidas não recebem novas confirmações.",
  CLOSED: "Ocorrências encerradas não recebem novas confirmações.",
  INVALID_TRANSITION:
    "O status mudou. Atualize a página para ver a etapa atual.",
  REQUEST_CONFLICT:
    "Este envio já foi usado com outros dados. Tente enviar novamente.",
  INVALID_PHOTO: "A foto deve estar em formato JPEG, PNG ou WebP.",
  PHOTO_TOO_LARGE: "A foto deve ter até 5 MB.",
  UNAVAILABLE: "O serviço está indisponível. Tente novamente em instantes.",
  INTERNAL: "Ocorreu um erro ao processar a solicitação.",
};

export class RequestError extends Error {
  readonly code: ApiErrorCode;
  readonly field?: string;

  constructor(code: ApiErrorCode, field?: string) {
    super(messages[code] ?? messages.INTERNAL);
    this.code = code;
    this.field = field;
  }
}

type Options = RequestInit & { token?: string };

let sessionExpired: ((token: string) => void) | undefined;

export function onSessionExpired(handler: (token: string) => void) {
  sessionExpired = handler;
  return () => {
    if (sessionExpired === handler) sessionExpired = undefined;
  };
}
type Reply<T> = { data: T } | { error: { code: ApiErrorCode; field?: string } };

async function request<T>(
  path: string,
  { token, ...options }: Options = {},
  decode?: (response: Response) => Promise<T>,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  if (typeof options.body === "string")
    headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const cancel = () => controller.abort();
  const signal = options.signal;
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 12_000);

  try {
    const response = await fetch(base + path, {
      ...options,
      headers,
      signal: controller.signal,
    });
    if (response.ok && decode) return await decode(response);
    const reply: Reply<T> = await response.json();
    if ("error" in reply) {
      if (token && reply.error.code === "INVALID_IDENTITY")
        sessionExpired?.(token);
      throw new RequestError(reply.error.code, reply.error.field);
    }
    if (!response.ok) throw new RequestError("UNAVAILABLE");
    return reply.data;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new Error(
      "Não foi possível conectar à API. Verifique a conexão e tente novamente.",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export const api = {
  reverseLocation: async (
    token: string,
    latitude: number,
    longitude: number,
    candidate?: AddressMatch,
  ) => {
    const result = await request<unknown>("/locations/reverse", {
      token,
      method: "POST",
      body: JSON.stringify({ latitude, longitude, candidate }),
    });
    if (result === null) return null;
    const parsed = selectedLocationInput.safeParse(result);
    if (!parsed.success)
      throw new Error(
        "Resposta de localização incompleta. Atualize a API e tente novamente.",
      );
    return parsed.data;
  },
  searchAddress: async (token: string, query: string) => {
    const result = await request<unknown>("/locations/search", {
      token,
      method: "POST",
      body: JSON.stringify({ query }),
    });
    const parsed = z.array(selectedLocationInput).safeParse(result);
    if (!parsed.success)
      throw new Error(
        "Resposta de endereço incompleta. Atualize a API e tente novamente.",
      );
    return parsed.data;
  },
  locateIssue: async (token: string, id: string, point: AddressMatch) => {
    try {
      return await request<IssueDetail>("/issues/" + id + "/location", {
        token,
        method: "PATCH",
        body: JSON.stringify(point),
      });
    } catch (error) {
      if (error instanceof RequestError && error.code === "REQUEST_CONFLICT")
        throw new Error(
          "Esta ocorrência já tem um ponto no mapa. Atualize os detalhes.",
        );
      throw error;
    }
  },
  register: (input: { email: string; password: string; name: string }) =>
    request<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  login: (input: { email: string; password: string }) =>
    request<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  profile: (token: string, signal?: AbortSignal) =>
    request<UserProfile>("/auth/profile", { token, signal }),
  updateProfile: (token: string, name: string) =>
    request<UserProfile>("/auth/profile", {
      token,
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  logout: (token: string) =>
    request<null>("/auth/session", { token, method: "DELETE" }),
  categories: (signal?: AbortSignal) =>
    request<Category[]>("/categories", { signal }),
  issues: (token: string, params: URLSearchParams, signal?: AbortSignal) =>
    request<Page<Issue>>("/issues?" + params.toString(), { token, signal }),
  issue: (token: string, id: string, signal?: AbortSignal) =>
    request<IssueDetail>("/issues/" + id, { token, signal }),
  issueMap: (token: string, params: URLSearchParams, signal?: AbortSignal) =>
    request<IssueMap>("/issues/map?" + params.toString(), { token, signal }),
  photo: (token: string, id: number) => ({
    uri: base + "/issues/" + id + "/photo",
    headers: { Authorization: "Bearer " + token },
  }),
  photoBlob: (token: string, id: number, signal: AbortSignal) =>
    request<Blob>("/issues/" + id + "/photo", { token, signal }, (response) =>
      response.blob(),
    ),
  metrics: (token: string, signal?: AbortSignal) =>
    request<Metrics>("/metrics", { token, signal }),
  async create(
    token: string,
    draft: IssueInput,
    key: string,
    photoUri?: string,
  ) {
    let body: string | FormData = JSON.stringify(draft);
    if (photoUri) {
      const form = new FormData();
      form.append("issue", body);
      if (Platform.OS === "web")
        form.append(
          "photo",
          await (await fetch(photoUri)).blob(),
          "occurrence.jpg",
        );
      else form.append("photo", new File(photoUri));
      body = form;
    }
    return request<IssueDetail>("/issues", {
      token,
      method: "POST",
      headers: { "Idempotency-Key": key },
      body,
    });
  },
  confirm: (token: string, id: string, confirmed: boolean) =>
    request<IssueDetail>(`/issues/${id}/confirmations`, {
      token,
      method: confirmed ? "DELETE" : "POST",
    }),
  closeIssue: (token: string, id: string, note: string) =>
    request<IssueDetail>(`/issues/${id}/close`, {
      token,
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  changeStatus: (token: string, id: string, status: Status, note: string) =>
    request<IssueDetail>(`/issues/${id}/status`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),
};
