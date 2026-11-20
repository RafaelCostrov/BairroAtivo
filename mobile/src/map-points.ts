import type { IssueMapPoint, Status } from "@bairroativo/shared";

export type IssueMapProps = {
  points: IssueMapPoint[];
  onOpen?: (id: number) => void;
  label?: string;
};

export const mapCenter = { latitude: -14.235, longitude: -51.9253 };

export const pinColors: Record<Status, string> = {
  OPEN: "#344B82",
  IN_PROGRESS: "#A85D10",
  RESOLVED: "#19755E",
  CLOSED: "#697570",
};
