import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const externalContactsTable = pgTable("external_contacts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizationsTable.id)
    .notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  jobTitle: text("job_title"),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ExternalContact = typeof externalContactsTable.$inferSelect;
export type InsertExternalContact = typeof externalContactsTable.$inferInsert;
