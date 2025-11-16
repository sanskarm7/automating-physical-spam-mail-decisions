import * as cheerio from "cheerio";

export type MailPiece = {
  senderGuess: string | null;
  imageUrl: string | null;
  deliveryDate: string | null;
};

// Things we never want to treat as mailpieces (logos, social icons, etc.)
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
  const $: cheerio.CheerioAPI = cheerio.load(html);
  const pieces: MailPiece[] = [];

  const mainDate = extractMainDate($);

  $("img").each((_, el) => {
    const img: cheerio.Cheerio<cheerio.AnyNode> = $(el);
    const src = img.attr("src");
    if (!src) return;

    // USPS uses cid: URLs for actual letter scans and campaign tiles
    if (!src.toLowerCase().startsWith("cid:")) return;

    if (isIgnoredImage(img)) return;
    if (isTooSmall(img)) return;

    const container: cheerio.Cheerio<cheerio.AnyNode> =
      img.closest("td, div, table").first();
    if (!container.length) return;

    const sender = getSenderForImage($, img, container);
    const deliveryDate = extractDeliveryDate($, img, mainDate);

    const containerText = normalizeWhitespace(container.text());
    const fallbackSender =
      sender || deriveFallbackSenderFromText(containerText);

    pieces.push({
      senderGuess: fallbackSender,
      imageUrl: src,
      deliveryDate: deliveryDate || mainDate,
    });
  });

  // Remove duplicates by their cid URL
  const uniq = new Map<string, MailPiece>();
  for (const p of pieces) {
    if (!p.imageUrl) continue;
    if (!uniq.has(p.imageUrl)) uniq.set(p.imageUrl, p);
  }

  return Array.from(uniq.values());
}

/* -------------------------- image filtering -------------------------- */

function isIgnoredImage(
  img: cheerio.Cheerio<cheerio.AnyNode>
): boolean {
  const src = img.attr("src") || "";
  const alt = (img.attr("alt") || "").toLowerCase();

  return IGNORED_IMAGE_PATTERNS.some((pattern) => {
    return pattern.test(src) || pattern.test(alt);
  });
}

// Ignore tiny icons (tracking dots, dividers, etc.)
function isTooSmall(
  img: cheerio.Cheerio<cheerio.AnyNode>
): boolean {
  const width = parseInt(img.attr("width") || "0", 10);
  const height = parseInt(img.attr("height") || "0", 10);
  return (width > 0 && width < 50) || (height > 0 && height < 50);
}

/* -------------------------- sender extraction -------------------------- */

function getSenderForImage(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<cheerio.AnyNode>,
  container: cheerio.Cheerio<cheerio.AnyNode>
): string | null {
  // First check if USPS put the official campaign sender here
  const campaignSender = getSenderFromCampaignSpan($, img);
  if (campaignSender) return campaignSender;

  // Try the table the image lives in
  const table = img.closest("table");
  if (table.length) {
    for (const row of table.find("tr").toArray()) {
      const rowText = normalizeWhitespace($(row).text());
      const sender = extractSender(rowText);
      if (sender) return sender;
    }
  }

  // Try its row
  const row = img.closest("tr");
  if (row.length) {
    const rowText = normalizeWhitespace(row.text());
    const sender = extractSender(rowText);
    if (sender) return sender;
  }

  // Walk up a few levels in case the sender text is nearby
  let cur: cheerio.Cheerio<cheerio.AnyNode> = container;
  for (let i = 0; i < 5 && cur.length; i++) {
    const text = normalizeWhitespace(cur.text());
    const sender = extractSender(text);
    if (sender) return sender;
    cur = cur.parent();
  }

  // Look at siblings too
  for (const sib of container.siblings().toArray()) {
    const text = normalizeWhitespace($(sib).text());
    const sender = extractSender(text);
    if (sender) return sender;
  }

  return null;
}

function getSenderFromCampaignSpan(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<cheerio.AnyNode>
): string | null {
  // USPS puts campaign sender text in a <span id="campaign-from-span-id">
  const table = img.closest("table");
  if (table.length) {
    const span = table.find("#campaign-from-span-id").first();
    if (span.length) return cleanText(span.text());
  }

  // As a backup, walk upwards and look for the same span
  let cur: cheerio.Cheerio<cheerio.AnyNode> = img.parent();
  for (let i = 0; i < 5 && cur.length; i++) {
    const span = cur.find("#campaign-from-span-id").first();
    if (span.length) return cleanText(span.text());
    cur = cur.parent();
  }

  return null;
}

// Pulls a clean "From: ____" string out of text if present
function extractSender(text: string): string | null {
  const fromPattern =
    text.match(/FROM:\s*([^\n\r]+)/i) ||
    text.match(/From:\s*([^\n\r]+)/i);

  if (fromPattern) {
    const sender = cleanText(fromPattern[1]);
    if (isMeaningfulSender(sender)) return sender;
  }

  // Try simple company-like patterns as a fallback
  const namePattern =
    /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){1,4})/g;
  const matches = text.matchAll(namePattern);
  for (const m of matches) {
    const candidate = cleanText(m[1]);
    if (isMeaningfulSender(candidate)) return candidate;
  }

  return null;
}

function isMeaningfulSender(text: string): boolean {
  if (!text || text.length < 2) return false;
  return !/Learn|Mail|Package|Dashboard|View|Expected|Today|Week|Icon|Click/i.test(
    text
  );
}

function deriveFallbackSenderFromText(text: string): string | null {
  if (!text) return null;
  const snippet = cleanText(text.slice(0, 120));
  if (isMeaningfulSender(snippet) && /^[A-Z]/.test(snippet)) {
    return snippet;
  }
  return null;
}

/* -------------------------- date extraction -------------------------- */

// USPS includes the real delivery date in their tracking pixel query params
function extractMainDate($: cheerio.CheerioAPI): string | null {
  const tracking = $('img[src*="emailRead?"]').attr("src");
  if (tracking) {
    const match = tracking.match(/[?&]deliveryDate=([^&]+)/);
    if (match) {
      const d = new Date(decodeURIComponent(match[1]));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  // The header also has day / month / year
  const day = $("#date-number").text().trim();
  const month = $("#month").text().trim();
  const year = $("#year").text().trim();

  if (day && month && year) {
    const monthNum = monthFromName(month);
    return `${year}-${monthNum}-${day.padStart(2, "0")}`;
  }

  // Loose fallback if nothing else is available
  const body = $("body").text();

  const m = body.match(/(\w+),\s+(\d{1,2})\/(\d{1,2})/);
  if (m) {
    const yearGuess = new Date().getFullYear();
    return `${yearGuess}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  return null;
}

// Assigns section-specific dates: "Expected Today", "Expected This Week"
function extractDeliveryDate(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<cheerio.AnyNode>,
  mainDate: string | null
): string | null {
  const section = findSectionForImage($, img);

  if (section === "today") return mainDate;

  if (section === "week") {
    const txt = normalizeWhitespace(
      $("#thisweek-date-span-id").text()
    );
    const parsed = parseLooseDate(txt);
    return parsed || null;
  }

  return null;
}

type Section = "today" | "week" | null;

// Determines which part of the digest this image belongs to
function findSectionForImage(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<cheerio.AnyNode>
): Section {
  const maxDepth = 15;
  let cur: cheerio.Cheerio<cheerio.AnyNode> =
    img.closest("td, div, table");

  for (let i = 0; i < maxDepth && cur.length; i++) {
    const id = cur.attr("id");
    if (id === "expected-today") return "today";
    if (id === "thisweek-saturation") return "week";
    cur = cur.parent();
  }

  return null;
}

/* -------------------------- helpers -------------------------- */

function monthFromName(name: string): string {
  const map: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  return map[name.toLowerCase()] || "01";
}

function parseLooseDate(text: string): string | null {
  const m = text.match(
    /([A-Z][a-z]+)\s+(\d{1,2})(?:-\d{1,2})?,?\s+(\d{4})/
  );
  if (!m) return null;

  const month = monthFromName(m[1]);
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}
