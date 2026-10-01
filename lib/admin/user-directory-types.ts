export type AdminUserView = "all" | "paid" | "usage";

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
  lastSeen?: string;
};

export type AdminUserPage = {
  users: AdminDirectoryUser[];
  total: number;
  page: number;
  limit: number;
  view: AdminUserView;
  query: string;
  dataHealth: { degraded: boolean; unavailable: string[] };
};
