
import { sqliteTable, text, integer, int } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // Google sub
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  gmailMsgId: text("gmail_msg_id").notNull().unique(),
  deliveryDate: text("delivery_date"),
  rawSenderText: text("raw_sender_text"),
  imgHash: text("img_hash"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const senders = sqliteTable("senders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonicalName: text("canonical_name").notNull(),
  aliasesJson: text("aliases_json").notNull(), // JSON string of aliases
  category: text("category"),
  optOutJson: text("opt_out_json"),            // JSON with {type,url,fields}
  supportEmail: text("support_email")
});

export const decisions = sqliteTable("decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  pieceHash: text("piece_hash").notNull(),
  senderId: integer("sender_id").references(() => senders.id),
  action: text("action").notNull(), // keep | opt_out | rts
  auto: int("auto", { mode: "boolean" }).default(false),
  decidedAt: text("decided_at").default(sql`CURRENT_TIMESTAMP`)
});

export const actions = sqliteTable("actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  decisionId: integer("decision_id").notNull().references(() => decisions.id),
  type: text("type").notNull(),       // web_form | email | instructions
  endpoint: text("endpoint"),
  payloadJson: text("payload_json"),
  status: text("status").default("pending"),
  submittedAt: text("submitted_at"),
  expectedStopBy: text("expected_stop_by")
});
