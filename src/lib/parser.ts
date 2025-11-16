
import * as cheerio from "cheerio";

export type MailPiece = {
  senderGuess: string | null;
  imageUrl: string | null;
  deliveryDate: string | null;
};

// Images to ignore (logos, icons, social media, etc.)
const IGNORED_IMAGE_PATTERNS = [
  /logo/i,
  /icon/i,
  /facebook/i,
  /twitter/i,
  /x\.com/i,
  /email.*icon/i,
  /text.*icon/i,
  /share/i,
  /dashboard/i,
  /banner/i,
  /footer/i,
  /header/i,
  /social/i,
  /usps.*logo/i,
  /eagle/i,
  /envelope.*icon/i,
  /package.*icon/i,
];

export function parseInformedDeliveryTiles(html: string): MailPiece[] {
  const $ = cheerio.load(html);
  const pieces: MailPiece[] = [];

  // Extract the main digest date from the subject/header
  const mainDate = extractMainDate($);

  // Find mail piece images - USPS typically structures these in tables or divs
  // Look for images that are likely mail pieces (not logos/icons)
  $("img").each((_, el) => {
    const img = $(el);
    const src = img.attr("src");
    if (!src) return;

    // Skip ignored images (logos, icons, etc.)
    const alt = (img.attr("alt") || "").toLowerCase();
    const isIgnored = IGNORED_IMAGE_PATTERNS.some(pattern => 
      pattern.test(src) || pattern.test(alt)
    );
    if (isIgnored) return;

    // Skip very small images (likely icons)
    const width = parseInt(img.attr("width") || "0");
    const height = parseInt(img.attr("height") || "0");
    if (width > 0 && width < 50) return;
    if (height > 0 && height < 50) return;

    // Find the parent container that likely contains sender info
    // USPS emails typically structure mail pieces in table cells or divs
    let container = img.closest("td, div, table").first();
    if (container.length === 0) return;

    let sender: string | null = null;
    
    // Strategy 1: USPS uses <span id="campaign-from-span-id"> to contain sender names
    // Find the parent table that contains this image, then look for the span
    const parentTable = img.closest("table");
    if (parentTable.length > 0) {
      const senderSpan = parentTable.find('span[id="campaign-from-span-id"]');
      if (senderSpan.length > 0) {
        const senderText = senderSpan.text().trim();
        if (senderText && senderText.length > 0) {
          sender = cleanText(senderText);
        }
      }
    }
    
    // Strategy 2: Look for "FROM:" in the same table but different row
    if (!sender) {
      const table = img.closest("table");
      if (table.length > 0) {
        // Find all table rows in this table
        const rows = table.find("tr");
        for (let i = 0; i < rows.length && !sender; i++) {
          const rowText = $(rows[i]).text().replace(/\s+/g, " ").trim();
          sender = extractSender(rowText);
        }
      }
    }
    
    // Strategy 3: Check the containing table row (if in a table)
    if (!sender) {
      const row = img.closest("tr");
      if (row.length > 0) {
        const rowText = row.text().replace(/\s+/g, " ").trim();
        sender = extractSender(rowText);
      }
    }
    
    // Strategy 4: Check parent elements (table, div) within a few levels up
    if (!sender) {
      let current = container;
      for (let i = 0; i < 5 && current.length > 0 && !sender; i++) {
        const text = current.text().replace(/\s+/g, " ").trim();
        sender = extractSender(text);
        current = current.parent();
      }
    }
    
    // Strategy 5: Check siblings - sometimes sender info is in adjacent cells
    if (!sender) {
      const siblings = container.siblings();
      for (let i = 0; i < siblings.length && !sender; i++) {
        const text = siblings.eq(i).text().replace(/\s+/g, " ").trim();
        sender = extractSender(text);
      }
    }
    
    // Strategy 6: Check previous siblings - USPS puts FROM: before the image row
    if (!sender) {
      const prevSiblings = container.parent().prevAll().find('span[id="campaign-from-span-id"]');
      if (prevSiblings.length > 0) {
        const senderText = prevSiblings.first().text().trim();
        if (senderText && senderText.length > 0) {
          sender = cleanText(senderText);
        }
      }
    }

    // Determine delivery date - check if image is in "Expected Today" or "Expected This Week" section
    const deliveryDate = extractDeliveryDate($, container, mainDate);

    // If still no sender, try to extract from container text but filter out junk
    const containerText = container.text().replace(/\s+/g, " ").trim();
    let fallbackSender = sender;
    if (!fallbackSender && containerText) {
      // Only use fallback if it looks like a real sender name
      const cleaned = cleanText(containerText.slice(0, 120));
      if (cleaned && cleaned.length > 2 && 
          !/Learn more|mail|package|dashboard|view|expected|today|week|icon|click/i.test(cleaned) &&
          /^[A-Z]/.test(cleaned)) {
        fallbackSender = cleaned;
      }
    }

    pieces.push({
      senderGuess: sender || fallbackSender || null,
      imageUrl: src,
      deliveryDate: deliveryDate || mainDate
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

function extractMainDate($: cheerio.CheerioAPI): string | null {
  const bodyText = $("body").text();
  
  // Try "Your Daily Digest for Sat, 11/15" or "Sat, 11/15"
  let m = bodyText.match(/Daily Digest for\s+([A-Z][a-z]{2}),\s+(\d{1,2})\/(\d{1,2})/i);
  if (m) {
    const month = parseInt(m[2]);
    const day = parseInt(m[3]);
    const currentYear = new Date().getFullYear();
    return `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  
  // Try full date format: "Saturday, 15 November 2025"
  m = bodyText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})/i);
  if (m) {
    const monthNames: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12"
    };
    const month = monthNames[m[3].toLowerCase()];
    const day = m[2].padStart(2, '0');
    return `${m[4]}-${month}-${day}`;
  }
  
  // Try "Saturday 15 November 2025"
  m = bodyText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})/i);
  if (m) {
    const monthNames: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12"
    };
    const month = monthNames[m[3].toLowerCase()];
    const day = m[2].padStart(2, '0');
    return `${m[4]}-${month}-${day}`;
  }
  
  return null;
}

function extractSender(text: string): string | null {
  // Look for "FROM: [sender name]" pattern - be more flexible with whitespace
  let fromMatch = text.match(/FROM:\s*([^\n\r]+?)(?:\s+campaign|\s*$)/i);
  if (!fromMatch) {
    // Try with different case variations
    fromMatch = text.match(/From:\s*([^\n\r]+?)(?:\s+campaign|\s*$)/i);
  }
  if (!fromMatch) {
    // Try "FROM" on its own line or with punctuation
    fromMatch = text.match(/FROM[:\s]+([A-Z][A-Za-z0-9\s&,\-\.]+?)(?:\s+campaign|\s*Learn|\s*$)/i);
  }
  
  if (fromMatch) {
    const sender = fromMatch[1].trim();
    // Filter out obvious junk
    if (sender && sender.length > 1 && 
        !/Learn more|mail|package|dashboard|view|expected|today|week|icon|click|share/i.test(sender)) {
      return cleanText(sender);
    }
  }
  
  // Try to find sender-like text patterns (capitalized words that might be company names)
  // Look for capitalized phrases that appear near mail piece context
  const senderPatterns = [
    /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)(?:\s+campaign)?/g, // Multiple capitalized words
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g, // Company name patterns
  ];
  
  for (const pattern of senderPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const candidate = match[1].trim();
      // Exclude common false positives and too short/long
      if (candidate.length >= 3 && candidate.length < 80 &&
          !/Expected|Today|Week|Mail|Package|Dashboard|View|Learn|Share|Click|Icon|Button/i.test(candidate) &&
          candidate.split(/\s+/).length <= 5) { // Max 5 words
        return cleanText(candidate);
      }
    }
  }
  
  return null;
}

function extractDeliveryDate($: cheerio.CheerioAPI, container: cheerio.Cheerio<cheerio.Element>, mainDate: string | null): string | null {
  // Check if container is in "Expected Today" section
  const parentText = container.parent().parent().text().toLowerCase();
  if (/expected\s+today/i.test(parentText)) {
    return mainDate; // Use the digest date for "Expected Today"
  }
  
  // For "Expected This Week", we'd need to parse the week dates
  // For now, return null and use mainDate as fallback
  if (/expected\s+this\s+week/i.test(parentText)) {
    // Could try to extract specific date from context, but mainDate is reasonable fallback
    return null;
  }
  
  return null;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/campaign\s*$/i, "")
    .trim()
    .slice(0, 120);
}
