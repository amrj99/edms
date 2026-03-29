import { pgTable, serial, text, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

export const chatGroupTypeEnum = pgEnum("chat_group_type", ["project", "department", "general"]);
export const chatMemberRoleEnum = pgEnum("chat_member_role", ["admin", "member"]);

export const chatGroupsTable = pgTable("chat_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: chatGroupTypeEnum("type").notNull().default("general"),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  department: text("department"),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chatGroupMembersTable = pgTable("chat_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").references(() => chatGroupsTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  role: chatMemberRoleEnum("role").notNull().default("member"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").references(() => chatGroupsTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  content: text("content").notNull(),
  parentId: integer("parent_id"), // for threaded replies — self-reference
  messageType: text("message_type").notNull().default("text"), // text | file | image
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessageReadsTable = pgTable("chat_message_reads", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").references(() => chatMessagesTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  readAt: timestamp("read_at").defaultNow().notNull(),
});

export const insertChatGroupSchema = createInsertSchema(chatGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });

export type ChatGroup = typeof chatGroupsTable.$inferSelect;
export type ChatGroupMember = typeof chatGroupMembersTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type InsertChatGroup = z.infer<typeof insertChatGroupSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
