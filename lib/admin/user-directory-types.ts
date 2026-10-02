export type AdminUserView = "all" | "paid" | "credits" | "usage";

export type AdminDirectoryUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  banned: boolean | null;
  createdAt?: string;
  analysisCount?: number;
  orderCount?: number;
  totalPaidCents?: number;
  latestPackageName?: string;
  lastPaidAt?: string;
  uploads?: number;
  uploadBytes?: number;
  analyses?: number;
  generations?: number;
  creditBalance?: number;
  legacyBalance?: number;
  commercialBalance?: number;
  heldCredits?: number;
  ledgerBalance?: number;
  manualCredits?: number;
  unverifiedCredits?: number;
  auditStatus?: "balance_mismatch" | "unverified_source" | "manual_grant" | "ledger_consistent";
  lastSeen?: string;
};

export type AdminFinancialEntry = {
  id: string; kind: "order" | "legacy" | "commercial"; createdAt: string;
  status?: string; packageName?: string; provider?: string; reference?: string;
  amountCents?: number; currency?: string; credits: number; note?: string;
  actorEmail?: string | null;
  paidAt?: string | null;
  tradeReference?: string | null;
};
export type AdminFinancialPage = { entries: AdminFinancialEntry[]; total: number; page: number; limit: number };

export type AdminUserPage = {
  users: AdminDirectoryUser[];
  total: number;
  page: number;
  limit: number;
  view: AdminUserView;
  query: string;
  dataHealth: { degraded: boolean; unavailable: string[] };
};
