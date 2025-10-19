
import * as cheerio from "cheerio";

export type MailPiece = {
  senderGuess: string | null;
  imageUrl: string | null;
  deliveryDate: string | null;
};

export function parseInformedDeliveryTiles(html: string): MailPiece[] {
  const $ = cheerio.load(html);
  const pieces: MailPiece[] = [];

  // Heuristic: pick all images, then try to capture nearby text as sender name
  $("img").each((_, el) => {
    const img = $(el).attr("src") || null;
    if (!img) return;
    const parent = $(el).closest("table,div,td");
    const text = parent.text().replace(/\s+/g, " ").trim();
    const sender = text ? text.slice(0, 120) : null;
    pieces.push({
      senderGuess: sender,
      imageUrl: img,
      deliveryDate: extractLikelyDate($)
    });
  });

  // Deduplicate by imageUrl
  const uniq = new Map<string, MailPiece>();
  for (const p of pieces) {
    if (!p.imageUrl) continue;
    if (!uniq.has(p.imageUrl)) uniq.set(p.imageUrl, p);
  }
  return Array.from(uniq.values());
}

function extractLikelyDate($: cheerio.CheerioAPI): string | null {
  const bodyText = $("body").text();
  const m = bodyText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  return m ? m[0] : null;
}
