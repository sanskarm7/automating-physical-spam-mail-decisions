
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
 const q = process.env.GMAIL_QUERY || 'from:wlrsanskar@gmail.com subject:"mail_test" newer_than:60d';
 
 console.log('Searching Gmail with query:', q);
 const list = await listDigestMessages(gmail, q);
 console.log(`📧 Found ${list.length} messages`);

 let inserted = 0;
 for (const m of list) {
   const id = m.id!;
   console.log(`Processing message ${id}...`);
   const html = await getMessageHtml(gmail, id);
   if (!html) {
     console.log('  ⚠️  No HTML found');
     continue;
   }
   console.log(`Downloaded HTML (${html.length} chars)`);
   
   const tiles = parseInformedDeliveryTiles(html);
   console.log(`  🖼️  Found ${tiles.length} mail piece(s)`);
   
   for (const t of tiles) {
     const img = t.imageUrl || "";
     const date = t.deliveryDate || "";
     const hash = createHash("sha256").update(img + "|" + date).digest("hex");
     console.log(`    • Sender: ${t.senderGuess?.slice(0, 40)}, Date: ${date}, Hash: ${hash.slice(0, 8)}...`);
     try {
       db.insert(messages).values({
         userId: (session as any).userId,
         gmailMsgId: id,
         deliveryDate: date,
         rawSenderText: t.senderGuess ?? null,
         imgHash: hash
       }).run();
       inserted++;
       console.log(`Inserted`);
     } catch {
       console.log(`Skipped (duplicate)`);
     }
   }
 }

 console.log(`\n✨ Total inserted: ${inserted}`);
 return NextResponse.json({ ok: true, inserted });
}