
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGmailClient, listDigestMessages, getMessageHtml } from "@/lib/gmail";
import { db } from "@/db/client";
import { messages } from "@/db/schema";
import { parseInformedDeliveryTiles } from "@/lib/parser";
import { createHash } from "crypto";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = (session as any).access_token;
  if (!token) {
    return NextResponse.json({ error: "no access token on session. configure NextAuth token callbacks." }, { status: 400 });
  }
  const gmail = getGmailClient(token);
  const q = process.env.GMAIL_QUERY || 'from:USPSInformedDelivery@usps.gov subject:"Informed Delivery Daily Digest" newer_than:60d';
  const list = await listDigestMessages(gmail, q);

  let inserted = 0;
  for (const m of list) {
    const id = m.id!;
    const html = await getMessageHtml(gmail, id);
    if (!html) continue;
    const tiles = parseInformedDeliveryTiles(html);
    for (const t of tiles) {
      const img = t.imageUrl || "";
      const date = t.deliveryDate || "";
      const hash = createHash("sha256").update(img + "|" + date).digest("hex");
      try {
        db.insert(messages).values({
          userId: (session as any).userId,
          gmailMsgId: id,
          deliveryDate: date,
          rawSenderText: t.senderGuess ?? null,
          imgHash: hash
        }).run();
        inserted++;
      } catch {
        // duplicate, ignore
      }
    }
  }

  return NextResponse.json({ ok: true, inserted });
}
