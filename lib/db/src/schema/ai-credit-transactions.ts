import { pgTable, serial, integer, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const aiTransactionTypeEnum = pgEnum("ai_transaction_type", [
  "purchase",
  "consumption",
  "grant",
]);

export const aiFeatureEnum = pgEnum("ai_feature", [
  "ai_summary",
  "ai_classify",
  "ai_extract",
  "ai_search",
]);

export const aiCreditTransactionsTable = pgTable("ai_credit_transactions", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  amount:         integer("amount").notNull(),
  transactionType: aiTransactionTypeEnum("transaction_type").notNull(),
  feature:        aiFeatureEnum("feature"),
  metadata:       jsonb("metadata"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export type AiCreditTransaction = typeof aiCreditTransactionsTable.$inferSelect;
