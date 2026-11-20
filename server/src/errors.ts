import type { ApiErrorCode } from "@bairroativo/shared";
import { DatabaseUnavailable, oracleError } from "./database.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly field?: string;

  constructor(status: number, code: ApiErrorCode, field?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const databaseErrors = new Map([
  [20001, new ApiError(403, "FORBIDDEN")],
  [20002, new ApiError(404, "NOT_FOUND")],
  [20003, new ApiError(422, "INVALID_INPUT")],
  [20004, new ApiError(409, "ALREADY_CONFIRMED")],
  [20005, new ApiError(409, "RESOLVED")],
  [20006, new ApiError(409, "INVALID_TRANSITION")],
  [20007, new ApiError(409, "REQUEST_CONFLICT")],
  [20008, new ApiError(422, "INVALID_PHOTO")],
  [20009, new ApiError(409, "CLOSED")],
]);

export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const database = oracleError(error);
  const mapped = databaseErrors.get(database?.number ?? 0);
  if (mapped) return mapped;
  if (
    error instanceof DatabaseUnavailable ||
    /^(NJS-(040|500|501|503|511|518)|DPI-1067|ORA-(03113|03114|125[0-9]{2}))$/.test(
      database?.code ?? "",
    )
  ) {
    return new ApiError(503, "UNAVAILABLE");
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    if (error.status === 413) return new ApiError(413, "PHOTO_TOO_LARGE");
    if (error.status === 400) return new ApiError(400, "INVALID_INPUT");
  }
  return new ApiError(500, "INTERNAL");
}
