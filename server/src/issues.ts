import oracledb from "oracledb";
import type { Connection, ResultSet } from "oracledb";
import type {
  Category,
  UserSummary,
  IssueMap,
  IssueMapPoint,
  HistoryEntry,
  Issue,
  IssueDetail,
  IssueInput,
  Metrics,
  Page,
  Status,
  AddressMatch,
} from "@bairroativo/shared";
import type { output } from "zod";
import { ApiError } from "./errors.ts";
import { fetchCursor, rows } from "./database.ts";
import { requestHash } from "./validation.ts";
import type { listInput, Photo } from "./validation.ts";

type IssueRow = Omit<
  Issue,
  "category" | "author" | "hasPhoto" | "isSample" | "confirmed"
> & {
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  authorId: number;
  authorName: string;
  authorRole: UserSummary["role"];
  confirmed: number;
  hasPhoto: number;
  isSample: number;
};

const issueColumns = `
  SELECT i.id AS "id", i.title AS "title", i.description AS "description", i.severity AS "severity",
         i.status AS "status", c.id AS "categoryId", c.name AS "categoryName", c.code AS "categoryCode",
         u.id AS "authorId", u.display_name AS "authorName", u.role AS "authorRole",
         l.neighborhood AS "neighborhood", l.address AS "address", l.postal_code AS "postalCode",
         l.latitude AS "latitude", l.longitude AS "longitude",
         confirmations.total AS "confirmationCount",
         confirmations.confirmed AS "confirmed",
         pkg_issues.calculate_priority(i.severity, confirmations.total) AS "priorityScore",
         CASE WHEN i.photo IS NOT NULL THEN 1 ELSE 0 END AS "hasPhoto",
         i.is_sample AS "isSample",
         to_char(sys_extract_utc(i.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "createdAt",
         to_char(sys_extract_utc(i.updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "updatedAt"`;

const issueFrom = `
  FROM issue i
  JOIN issue_category c ON c.id = i.category_id
  JOIN app_user u ON u.id = i.author_id
  JOIN issue_location l ON l.id = i.location_id
  CROSS APPLY (
    SELECT count(*) AS total, count(CASE WHEN ic.user_id = :viewer THEN 1 END) AS confirmed
    FROM issue_confirmation ic WHERE ic.issue_id = i.id
  ) confirmations`;

function toIssue(row: IssueRow): Issue {
  const {
    categoryId,
    categoryName,
    categoryCode,
    authorId,
    authorName,
    authorRole,
    confirmed,
    hasPhoto,
    isSample,
    ...issue
  } = row;
  return {
    ...issue,
    category: { id: categoryId, name: categoryName, code: categoryCode },
    author: { id: authorId, name: authorName, role: authorRole },
    confirmed: confirmed === 1,
    hasPhoto: hasPhoto === 1,
    isSample: isSample === 1,
  };
}

export function categories(connection: Connection) {
  return rows<Category>(
    connection,
    'SELECT id AS "id", name AS "name", code AS "code" FROM issue_category ORDER BY name',
  );
}

const issueFilter = `
  (:category IS NULL OR i.category_id = :category)
  AND (:status IS NULL OR i.status = :status)
  AND (:hideClosed = 0 OR i.status <> 'CLOSED')
  AND (:author IS NULL OR i.author_id = :author)
  AND (:startDate IS NULL OR i.created_at >=
    from_tz(to_timestamp(:startDate, 'YYYY-MM-DD'), 'America/Sao_Paulo'))
  AND (:endDate IS NULL OR i.created_at <
    from_tz(to_timestamp(:endDate, 'YYYY-MM-DD') + INTERVAL '1' DAY, 'America/Sao_Paulo'))
  AND (:search IS NULL
    OR instr(i.title COLLATE BINARY_AI, :search) > 0
    OR instr(i.description COLLATE BINARY_AI, :search) > 0
    OR instr(l.neighborhood COLLATE BINARY_AI, :search) > 0
    OR instr(l.address COLLATE BINARY_AI, :search) > 0
    OR l.postal_code = :postalSearch)`;

function filters(
  viewer: number,
  {
    category,
    status,
    mine,
    search,
    startDate,
    endDate,
  }: output<typeof listInput>,
) {
  return {
    category: category ?? null,
    status: status === "ALL" ? null : (status ?? null),
    hideClosed: status === undefined && mine !== "true" ? 1 : 0,
    author: mine === "true" ? viewer : null,
    search: search || null,
    postalSearch: search?.replace("-", "") || null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  };
}

export async function mapIssues(
  connection: Connection,
  viewer: number,
  query: output<typeof listInput>,
): Promise<IssueMap> {
  const limit = 50;
  const points = await rows<IssueMapPoint>(
    connection,
    `SELECT i.id AS "id", i.title AS "title", i.status AS "status",
      l.neighborhood AS "neighborhood", l.latitude AS "latitude", l.longitude AS "longitude"
    FROM issue i JOIN issue_location l ON l.id = i.location_id
    WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL AND ${issueFilter}
    ORDER BY i.created_at DESC, i.id DESC OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY`,
    { ...filters(viewer, query), skip: query.offset, take: limit + 1 },
  );
  const unlocated = await rows<IssueMap["unlocated"][number]>(
    connection,
    `SELECT i.id AS "id", i.title AS "title", l.neighborhood AS "neighborhood"
    FROM issue i JOIN issue_location l ON l.id = i.location_id
    WHERE l.latitude IS NULL AND ${issueFilter}
    ORDER BY i.created_at DESC, i.id DESC FETCH FIRST 5 ROWS ONLY`,
    filters(viewer, query),
  );
  return {
    points: points.slice(0, limit),
    truncated: points.length > limit,
    nextOffset: points.length > limit ? query.offset + limit : null,
    unlocated,
  };
}

export async function locateIssue(
  connection: Connection,
  viewer: number,
  id: number,
  location: AddressMatch,
) {
  await connection.execute(
    "BEGIN pkg_issues.locate_issue(:id, :viewer, :latitude, :longitude, :neighborhood, :address, :postalCode); END;",
    {
      id,
      viewer,
      latitude: location.latitude,
      longitude: location.longitude,
      neighborhood: location.neighborhood,
      address: location.address,
      postalCode: location.postalCode,
    },
  );
}

export async function listIssues(
  connection: Connection,
  viewer: number,
  query: output<typeof listInput>,
): Promise<Page<Issue>> {
  const { order, offset, limit } = query;
  const orderBy =
    order === "priority"
      ? '"priorityScore" DESC, i.created_at DESC, i.id DESC'
      : "i.created_at DESC, i.id DESC";
  const results = await rows<IssueRow>(
    connection,
    `${issueColumns} ${issueFrom}
    WHERE ${issueFilter}
    ORDER BY ${orderBy} OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY`,
    {
      viewer,
      ...filters(viewer, query),
      skip: offset,
      take: limit + 1,
    },
  );
  return {
    items: results.slice(0, limit).map(toIssue),
    nextOffset: results.length > limit ? offset + limit : null,
  };
}

export async function issueDetail(
  connection: Connection,
  viewer: number,
  id: number,
): Promise<IssueDetail> {
  const [issue] = await rows<IssueRow & { severityPoints: number }>(
    connection,
    `${issueColumns},
    pkg_issues.calculate_priority(i.severity, 0) AS "severityPoints"
    ${issueFrom} WHERE i.id = :id`,
    { viewer, id },
  );
  if (!issue) throw new ApiError(404, "NOT_FOUND");
  const history = await rows<HistoryEntry>(
    connection,
    `
    SELECT h.id AS "id", h.previous_status AS "previousStatus", h.new_status AS "status",
           u.display_name AS "actorName", h.note AS "note",
           to_char(sys_extract_utc(h.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "createdAt"
    FROM issue_status_history h JOIN app_user u ON u.id = h.actor_id
    WHERE h.issue_id = :id ORDER BY h.created_at DESC, h.id DESC`,
    { id },
  );
  const { severityPoints, ...record } = issue;
  return { ...toIssue(record), severityPoints, history };
}

export async function createIssue(
  connection: Connection,
  viewer: number,
  issue: IssueInput,
  key: string,
  photo: Photo | null,
) {
  const result = await connection.execute<{ id: number; created: number }>(
    `BEGIN
    pkg_issues.create_issue(
      :viewer, :categoryId, :title, :description, :severity, :neighborhood, :address, :latitude,
      :longitude, :key, :hash, :photo, :mime, 0, :id, :created, :postalCode
    );
  END;`,
    {
      ...issue,
      description: issue.description ?? null,
      postalCode: issue.postalCode ?? null,
      latitude: { val: issue.latitude ?? null, type: oracledb.NUMBER },
      longitude: { val: issue.longitude ?? null, type: oracledb.NUMBER },
      viewer,
      key,
      hash: requestHash(issue, photo),
      photo: { val: photo?.buffer ?? null, type: oracledb.BLOB },
      mime: photo?.mime ?? null,
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      created: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  if (!result.outBinds) throw new Error("Missing output from create_issue");
  return result.outBinds;
}

export async function changeConfirmation(
  connection: Connection,
  viewer: number,
  id: number,
  add: boolean,
) {
  const procedure = add ? "add_confirmation" : "remove_confirmation";
  await connection.execute(
    `BEGIN pkg_issues.${procedure}(:id, :viewer); END;`,
    { id, viewer },
  );
}

export async function closeIssue(
  connection: Connection,
  viewer: number,
  id: number,
  note?: string,
) {
  await connection.execute(
    "BEGIN pkg_issues.close_issue(:id, :viewer, :note); END;",
    { id, viewer, note: note || null },
  );
}

export async function changeStatus(
  connection: Connection,
  viewer: number,
  id: number,
  status: Status,
  note?: string,
) {
  await connection.execute(
    "BEGIN pkg_issues.update_issue_status(:id, :viewer, :status, :note); END;",
    { id, viewer, status, note: note || null },
  );
}

export async function issuePhoto(
  connection: Connection,
  id: number,
): Promise<Photo> {
  const result = await connection.execute<Photo>(
    'SELECT photo AS "buffer", photo_mime AS "mime" FROM issue WHERE id = :id AND photo IS NOT NULL',
    { id },
    {
      fetchTypeHandler: (column) =>
        column.name === "buffer" ? { type: oracledb.BUFFER } : undefined,
    },
  );
  const [photo] = result.rows ?? [];
  if (!photo) throw new ApiError(404, "NOT_FOUND");
  return photo;
}

type MetricTotals = Omit<Metrics, "categories" | "neighborhoods">;
type MetricCursors = {
  totals: ResultSet<MetricTotals>;
  categories: ResultSet<Metrics["categories"][number]>;
  neighborhoods: ResultSet<Metrics["neighborhoods"][number]>;
};

export async function communityMetrics(
  connection: Connection,
): Promise<Metrics> {
  const cursor = { dir: oracledb.BIND_OUT, type: oracledb.CURSOR };
  const { outBinds } = await connection.execute<MetricCursors>(
    "BEGIN pkg_issues.get_community_metrics(:totals, :categories, :neighborhoods); END;",
    { totals: cursor, categories: cursor, neighborhoods: cursor },
  );
  if (!outBinds) throw new Error("Missing metric cursors");
  const opened = new Set<{ close(): Promise<void> }>([
    outBinds.totals,
    outBinds.categories,
    outBinds.neighborhoods,
  ]);
  try {
    opened.delete(outBinds.totals);
    const [totals] = await fetchCursor(outBinds.totals);
    if (!totals) throw new Error("Missing metric totals");
    opened.delete(outBinds.categories);
    const categories = await fetchCursor(outBinds.categories);
    opened.delete(outBinds.neighborhoods);
    const neighborhoods = await fetchCursor(outBinds.neighborhoods);
    return { ...totals, categories, neighborhoods };
  } finally {
    for (const result of opened) await result.close();
  }
}
