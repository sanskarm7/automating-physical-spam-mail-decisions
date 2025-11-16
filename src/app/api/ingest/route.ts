
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGmailClient, listDigestMessages, getMessageHtml, getImageByCid } from "@/lib/gmail";
import { db } from "@/db/client";
import { messages } from "@/db/schema";
import { parseInformedDeliveryTiles } from "@/lib/parser";
import { runOcr } from "@/lib/ocr";
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = (session as any).access_token;
  if (!token) {
    return NextResponse.json({ 
      error: "no access token on session. Please sign out and sign back in to refresh your authentication." 
    }, { status: 401 });
  }
  
  try {
    const gmail = getGmailClient(token);
    const q = process.env.GMAIL_QUERY || 'from:USPSInformeddelivery@email.informeddelivery.usps.com subject:"Daily Digest" newer_than:60d';
    
    console.log('Searching Gmail with query:', q);
    const list = await listDigestMessages(gmail, q);
    console.log(`Found ${list.length} messages`);

    let inserted = 0;
    for (const m of list) {
      const id = m.id!;
      console.log(`Processing message ${id}...`);
      const html = await getMessageHtml(gmail, id);
      if (!html) {
        console.log('  No HTML found');
        continue;
      }
      console.log(`Downloaded HTML (${html.length} chars)`);
      
      const tiles = parseInformedDeliveryTiles(html);
      console.log(`  Found ${tiles.length} mail piece(s)`);
      
      // Debug: Save first email's HTML to inspect structure
      if (list.indexOf(m) === 0) {
        const fs = await import('fs/promises');
        await fs.writeFile('./debug-email.html', html);
        console.log('  📝 Saved email HTML to debug-email.html for inspection');
      }
      
      for (const t of tiles) {
        const img = t.imageUrl || "";
        const date = t.deliveryDate || "";
        const hash = createHash("sha256").update(img + "|" + date).digest("hex");
        let sender = t.senderGuess;
        
        console.log(`    Sender: ${sender?.slice(0, 40) || '(none)'}, Date: ${date}, Hash: ${hash.slice(0, 8)}...`);
        
        let imageBuffer: Buffer | null = null;
        
        if (img.toLowerCase().startsWith("cid:")) {
          try {
            imageBuffer = await getImageByCid(gmail, id, img);
          } catch (error: any) {
            console.log(`      Failed to extract CID image: ${error.message || error}`);
          }
        } else if (img.startsWith("http://") || img.startsWith("https://")) {
          try {
            const response = await fetch(img);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              imageBuffer = Buffer.from(arrayBuffer);
            } else {
              console.log(`      Failed to download image: HTTP ${response.status}`);
            }
          } catch (error: any) {
            console.log(`      Failed to download remote image: ${error.message || error}`);
          }
        }
        
        if (imageBuffer) {
          try {
            const ocrResult = await runOcr(imageBuffer);
            console.log(`      OCR extracted ${ocrResult.lines.length} lines`);
          } catch (error: any) {
            console.log(`      OCR processing failed: ${error.message || error}`);
          }
        }
        
        // Check if this mail piece (by imgHash) already exists
        const existing = db.select()
          .from(messages)
          .where(and(
            eq(messages.imgHash, hash),
            eq(messages.userId, (session as any).userId)
          ))
          .limit(1)
          .all();
        
        if (existing.length > 0) {
          console.log(`      Skipped (duplicate mail piece)`);
          continue;
        }
        
        try {
          db.insert(messages).values({
            userId: (session as any).userId,
            gmailMsgId: id + "_" + hash.slice(0, 8), // Make unique by appending hash prefix
            deliveryDate: date,
            rawSenderText: sender ?? null,
            imgHash: hash
          }).run();
          inserted++;
          console.log(`      Inserted`);
        } catch (error: any) {
          console.log(`      Error: ${error.message || error}`);
        }
      }
    }

    console.log(`\nTotal inserted: ${inserted}`);
    return NextResponse.json({ ok: true, inserted });
  } catch (error: any) {
    // Handle Gmail API authentication errors
    if (error.code === 401 || error.response?.status === 401) {
      return NextResponse.json({ 
        error: "authentication failed. Please sign out and sign back in to refresh your access token." 
      }, { status: 401 });
    }
    
    console.error("Ingest error:", error);
    return NextResponse.json({ 
      error: error.message || "failed to ingest emails" 
    }, { status: 500 });
  }
}