
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
  llmSenderName: text("llm_sender_name"),
  llmConfidence: integer("llm_confidence"),
  llmMailType: text("llm_mail_type"),
  llmSummary: text("llm_summary"),
  llmIsImportant: int("llm_is_important", { mode: "boolean" }),
  llmImportanceReason: text("llm_importance_reason"),
  llmRawJson: text("llm_raw_json"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});
