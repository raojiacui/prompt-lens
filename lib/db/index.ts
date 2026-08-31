import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

const maxConnections = Number.parseInt(process.env.DATABASE_MAX_CONNECTIONS || "5", 10);

const client = postgres(connectionString, {
  max: Number.isFinite(maxConnections) && maxConnections > 0 ? maxConnections : 5,
  connect_timeout: 10,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });

export * from "./schema";
