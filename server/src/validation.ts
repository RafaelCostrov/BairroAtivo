import { createHash } from "node:crypto";
import {
  issueDateRange,
  issueInput,
  orders,
  statuses,
} from "@bairroativo/shared";
import type { IssueInput } from "@bairroativo/shared";
import { z } from "zod";
import { ApiError } from "./errors.ts";

export const resourceId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .transform(Number)
  .pipe(z.number().int().positive());
export const listInput = z
  .object({
    ...issueDateRange.shape,
    search: z.string().trim().max(100).optional(),
    category: resourceId.optional(),
    status: z.enum(["ALL", ...statuses]).optional(),
    order: z.enum(orders).default("recent"),
    offset: z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .default(0),
    limit: resourceId.pipe(z.number().max(50)).default(20),
    mine: z.enum(["true", "false"]).default("false"),
  })
  .refine(
    ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
    {
      path: ["endDate"],
    },
  );
export const addressSearchInput = z.strictObject({
  query: z.string().trim().min(8).max(300),
});
export const statusInput = z.object({
  status: z.enum(statuses),
  note: z.string().trim().max(500).optional(),
});

export function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const field = result.error.issues[0]?.path[0];
    throw new ApiError(
      422,
      "INVALID_INPUT",
      typeof field === "string" ? field : undefined,
    );
  }
  return result.data;
}

export function parseIssue(body: unknown, multipart: boolean) {
  if (!multipart) return parse(issueInput, body);
  if (
    typeof body !== "object" ||
    body === null ||
    !("issue" in body) ||
    typeof body.issue !== "string"
  ) {
    throw new ApiError(400, "INVALID_INPUT");
  }

  let value: unknown;
  try {
    value = JSON.parse(body.issue);
  } catch {
    throw new ApiError(400, "INVALID_INPUT");
  }
  return parse(issueInput, value);
}

export type Photo = { buffer: Buffer; mime: string };

export function validatePhoto(file?: Express.Multer.File): Photo | null {
  if (!file) return null;
  const { buffer, mimetype } = file;
  let mime: string | undefined;
  if (
    buffer.length >= 20 &&
    buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    buffer.toString("ascii", 12, 16) === "IHDR"
  )
    mime = "image/png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) &&
    buffer.subarray(-2).equals(Buffer.from("ffd9", "hex"))
  )
    mime = "image/jpeg";
  if (
    buffer.length >= 20 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP" &&
    buffer.readUInt32LE(4) === buffer.length - 8
  )
    mime = "image/webp";
  if (!mime || (mime !== mimetype && mimetype !== "application/octet-stream")) {
    throw new ApiError(422, "INVALID_PHOTO");
  }
  return { buffer, mime };
}

export function requestHash(issue: IssueInput, photo: Photo | null) {
  const hash = createHash("sha256").update(
    JSON.stringify([issue, photo?.mime ?? null]),
  );
  if (photo) hash.update(photo.buffer);
  return hash.digest();
}
