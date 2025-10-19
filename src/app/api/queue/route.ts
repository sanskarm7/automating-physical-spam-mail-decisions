
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = db.select().from(messages).where(eq(messages.userId, (session as any).userId)).orderBy(desc(messages.id)).limit(50).all();
  return NextResponse.json({ items: rows });
}
