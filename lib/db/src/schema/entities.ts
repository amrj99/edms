import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const entityTypeEnum = pgEnum("entity_type", [
  "company",
  "government",
  "individual",
  "ngo",
  "consortium",
]);

export const entitiesTable = pgTable("entities", {
  id:                 serial("id").primaryKey(),
  organizationId:     integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }).notNull(),
  name:               text("name").notNull(),
  type:               entityTypeEnum("type").notNull(),
  country:            text("country"),
  registrationNumber: text("registration_number"),
  parentEntityId:     integer("parent_entity_id"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_entities_org_id").on(t.organizationId),
  index("idx_entities_name").on(t.name),
]);

export const contactsTable = pgTable("contacts", {
  id:        serial("id").primaryKey(),
  entityId:  integer("entity_id").references(() => entitiesTable.id, { onDelete: "cascade" }).notNull(),
  name:      text("name").notNull(),
  email:     text("email"),
  phone:     text("phone"),
  jobTitle:  text("job_title"),
  userId:    integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_contacts_entity_id").on(t.entityId),
  index("idx_contacts_user_id").on(t.userId),
]);

export const insertEntitySchema = createInsertSchema(entitiesTable).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({
  id: true,
  entityId: true,
  createdAt: true,
  updatedAt: true,
});

export type Entity = typeof entitiesTable.$inferSelect;
export type InsertEntity = z.infer<typeof insertEntitySchema>;
export type Contact = typeof contactsTable.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
