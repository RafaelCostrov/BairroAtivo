import type { Severity, Status } from "@bairroativo/shared";

export const colors = {
  background: "#F6F8F5",
  surface: "#FFFFFF",
  ink: "#162A25",
  muted: "#51645E",
  border: "#D7E1DA",
  primary: "#12574A",
  primaryText: "#FFFFFF",
  tint: "#E6F0E9",
  warning: "#724514",
  warningTint: "#F6EADB",
  danger: "#9B392D",
  dangerTint: "#F8E8E3",
};

export const fonts = {
  regular: "DM Sans Regular",
  medium: "DM Sans Medium",
  bold: "DM Sans Bold",
};

export const spaces = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, section: 32 };
export const maxWidth = 720;
export const statusLabel: Record<Status, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em acompanhamento",
  RESOLVED: "Resolvida",
  CLOSED: "Encerrada",
};
export const statusTone: Record<
  Status,
  { backgroundColor: string; color: string }
> = {
  OPEN: { backgroundColor: "#DCEBFF", color: "#164484" },
  IN_PROGRESS: { backgroundColor: "#FFF0C2", color: "#805000" },
  RESOLVED: { backgroundColor: "#DCF2DF", color: "#216535" },
  CLOSED: { backgroundColor: "#E6E9ED", color: "#4B5563" },
};
export const severityLabel: Record<Severity, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
};

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
});
const fullDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDate(date: string, full = false) {
  return (full ? fullDate : shortDate).format(new Date(date));
}
