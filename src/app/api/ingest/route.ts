import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getGmailClient,
  listDigestMessages,
  getMessageHtml,
  getImageByCid,
} from "@/lib/gmail";
import { db } from "@/db/client";
import { messages } from "@/db/schema";
import { parseInformedDeliveryTiles } from "@/lib/parser";
import { runOcr } from "@/lib/ocr";
import { interpretMailWithGemini } from "@/lib/llm";
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";

const DEFAULT_QUERY =
  'from:USPSInformeddelivery@email.informeddelivery.usps.com subject:"Daily Digest" newer_than:60d';

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).access_token as string | undefined;
  const userId = (session as any).userId as string | undefined;

  if (!accessToken || !userId) {
    return NextResponse.json(
      {
        error:
          "no access token on session. Please sign out and sign back in to refresh your authentication.",
      },
      { status: 401 }
    );
  }

  try {
    const gmail = getGmailClient(accessToken);
    const query = process.env.GMAIL_QUERY || DEFAULT_QUERY;

    console.log("Searching Gmail with query:", query);
    const list = await listDigestMessages(gmail, query);
    console.log(`Found ${list.length} messages`);

    let inserted = 0;

    for (const [index, msg] of list.entries()) {
      const msgId = msg.id;
      if (!msgId) continue;

      console.log(`Processing message ${msgId}...`);

      const html = await getMessageHtml(gmail, msgId);
      if (!html) {
        console.log("No HTML found");
        continue;
      }

      console.log(`Downloaded HTML (${html.length} chars)`);

      const tiles = parseInformedDeliveryTiles(html);
      console.log(`Found ${tiles.length} mail piece(s)`);

      // Optional debug of first email HTML, guarded by env flag
      if (index === 0 && process.env.SAVE_DEBUG_EMAIL_HTML === "1") {
        const fs = await import("fs/promises");
        await fs.writeFile("./debug-email.html", html);
        console.log("Saved email HTML to debug-email.html");
      }

      for (const tile of tiles) {
        const imgUrl = tile.imageUrl || "";
        const deliveryDate = tile.deliveryDate || "";
        const hash = createHash("sha256")
          .update(imgUrl + "|" + deliveryDate)
          .digest("hex");

        let sender = tile.senderGuess;
        console.log(
          `Sender: ${sender?.slice(0, 40) || "(none)"}, Date: ${deliveryDate}, Hash: ${hash.slice(0, 8)}`
        );

        const imageBuffer = await loadMailImage(gmail, msgId, imgUrl);
        let ocrResult: Awaited<ReturnType<typeof runOcr>> | null = null;
        let llmInterpretation:
          | Awaited<ReturnType<typeof interpretMailWithGemini>>
          | null = null;

        if (imageBuffer) {
          try {
            ocrResult = await runOcr(imageBuffer);
            console.log(`OCR extracted ${ocrResult.lines.length} lines`);

            if (process.env.GOOGLE_API_KEY) {
              try {
                llmInterpretation = await interpretMailWithGemini(ocrResult);
                console.log(
                  `LLM: ${llmInterpretation.senderName || "no sender"} (${llmInterpretation.mailType})`
                );
                if (llmInterpretation.senderName && !sender) {
                  sender = llmInterpretation.senderName;
                }
              } catch (err: any) {
                console.log(
                  `LLM processing failed: ${err?.message || err}`
                );
              }
            }
          } catch (err: any) {
            console.log(`OCR processing failed: ${err?.message || err}`);
          }
        }

        const exists = db
          .select()
          .from(messages)
          .where(
            and(eq(messages.imgHash, hash), eq(messages.userId, userId))
          )
          .limit(1)
          .all();

        if (exists.length > 0) {
          console.log("      Skipped (duplicate mail piece)");
          continue;
        }

        try {
          db.insert(messages)
            .values({
              userId,
              gmailMsgId: `${msgId}_${hash.slice(0, 8)}`,
              deliveryDate,
              rawSenderText: sender ?? null,
              imgHash: hash,
              llmSenderName: llmInterpretation?.senderName ?? null,
              llmMailType: llmInterpretation?.mailType ?? null,
              llmSummary: llmInterpretation?.shortSummary ?? null,
              llmIsImportant: llmInterpretation?.isImportant ?? null,
              llmImportanceReason:
                llmInterpretation?.importanceReason ?? null,
              llmRawJson: llmInterpretation?.rawJson
                ? JSON.stringify(llmInterpretation.rawJson)
                : null,
            })
            .run();

          inserted++;
          console.log("      Inserted");
        } catch (err: any) {
          console.log(`      Insert error: ${err?.message || err}`);
        }
      }
    }

    console.log(`Total inserted: ${inserted}`);
    return NextResponse.json({ ok: true, inserted });
  } catch (error: any) {
    if (error?.code === 401 || error?.response?.status === 401) {
      return NextResponse.json(
        {
          error:
            "authentication failed. Please sign out and sign back in to refresh your access token.",
        },
        { status: 401 }
      );
    }

    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: error?.message || "failed to ingest emails" },
      { status: 500 }
    );
  }
}

async function loadMailImage(
  gmail: ReturnType<typeof getGmailClient>,
  messageId: string,
  imgUrl: string
): Promise<Buffer | null> {
  if (!imgUrl) return null;

  if (imgUrl.toLowerCase().startsWith("cid:")) {
    try {
      return await getImageByCid(gmail, messageId, imgUrl);
    } catch (err: any) {
      console.log(
        `      Failed to extract CID image: ${err?.message || err}`
      );
      return null;
    }
  }

  if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
    try {
      const response = await fetch(imgUrl);
      if (!response.ok) {
        console.log(
          `      Failed to download image: HTTP ${response.status}`
        );
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err: any) {
      console.log(
        `      Failed to download remote image: ${err?.message || err}`
      );
      return null;
    }
  }

  return null;
}
