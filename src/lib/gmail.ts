import { google, gmail_v1 } from "googleapis";

type GmailClient = gmail_v1.Gmail;

export function getGmailClient(accessToken: string): GmailClient {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function listDigestMessages(
  gmail: GmailClient,
  query: string
): Promise<gmail_v1.Schema$Message[]> {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 25,
  });

  return res.data.messages ?? [];
}

export async function getMessageHtml(
  gmail: GmailClient,
  id: string
): Promise<string | null> {
  const full = await gmail.users.messages.get({ userId: "me", id });
  const payload = full.data.payload;

  if (!payload) return null;

  const html =
    extractHtmlFromPayload(payload) ||
    extractHtmlFromParts(payload.parts ?? []);

  return html;
}

function extractHtmlFromPayload(
  payload: gmail_v1.Schema$MessagePart
): string | null {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeB64(payload.body.data);
  }
  return null;
}

function extractHtmlFromParts(
  parts: gmail_v1.Schema$MessagePart[]
): string | null {
  for (const part of parts) {
    const directHtml = extractHtmlFromPayload(part);
    if (directHtml) return directHtml;

    if (part.parts?.length) {
      const nestedHtml = extractHtmlFromParts(part.parts);
      if (nestedHtml) return nestedHtml;
    }
  }
  return null;
}

function decodeB64(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

/**
 * Extract an embedded image from a Gmail message by its Content-ID (cid: URL)
 * Returns the image as a Buffer, or null if not found
 */
export async function getImageByCid(
  gmail: GmailClient,
  messageId: string,
  cid: string
): Promise<Buffer | null> {
  // Remove "cid:" prefix if present and clean up
  const contentId = cid.replace(/^cid:/i, "").replace(/[<>]/g, "").trim();
  
  if (!contentId) {
    console.log(`      ⚠️  Empty Content-ID after parsing: ${cid}`);
    return null;
  }
  
  const full = await gmail.users.messages.get({ 
    userId: "me", 
    id: messageId,
    format: "full" // Need full message to get attachments
  });
  
  const payload = full.data.payload;
  if (!payload) {
    console.log(`      ⚠️  No payload in message ${messageId}`);
    return null;
  }
  
  // First try to find inline data (enable debug for first few calls)
  const enableDebug = !process.env.DISABLE_DEBUG_LOGGING;
  const inlineResult = await findAttachmentByCid(gmail, messageId, payload, contentId, 0, enableDebug);
  if (inlineResult) return inlineResult;
  
  // If not found, log debug info
  console.log(`      ⚠️  Could not find image with Content-ID: ${contentId} (from cid: ${cid})`);
  return null;
}

async function findAttachmentByCid(
  gmail: GmailClient,
  messageId: string,
  part: gmail_v1.Schema$MessagePart,
  targetCid: string,
  depth: number = 0,
  debug: boolean = false
): Promise<Buffer | null> {
  // Limit recursion depth for safety
  if (depth > 10) return null;
  
  // Check if this part has the matching Content-ID header
  const headers = part.headers || [];
  const contentIdHeader = headers.find(
    h => h.name?.toLowerCase() === "content-id"
  );
  
  // Debug: log all Content-IDs found (only for first few calls to avoid spam)
  if (debug && contentIdHeader?.value && depth === 0) {
    const partCid = contentIdHeader.value.replace(/[<>]/g, "").trim();
    console.log(`      🔍 Found Content-ID in message: ${partCid} (looking for: ${targetCid})`);
  }
  
  if (contentIdHeader?.value) {
    const partCid = contentIdHeader.value.replace(/[<>]/g, "").trim();
    const targetCidClean = targetCid.trim();
    
    // Try exact match first
    if (partCid === targetCidClean || partCid === `<${targetCidClean}>` || targetCidClean === `<${partCid}>`) {
      // Found the matching part!
      
      // Check if data is inline (small attachment)
      if (part.body?.data) {
        const normalized = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
        return Buffer.from(normalized, "base64");
      }
      
      // If body.attachmentId exists, fetch via attachments.get API
      if (part.body?.attachmentId) {
        try {
          const attachment = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: messageId,
            id: part.body.attachmentId
          });
          
          if (attachment.data?.data) {
            const normalized = attachment.data.data.replace(/-/g, "+").replace(/_/g, "/");
            return Buffer.from(normalized, "base64");
          }
        } catch (error) {
          console.log(`      ⚠️  Failed to fetch attachment ${part.body.attachmentId}: ${error}`);
        }
      }
      
      // If we matched but have no data, log it
      if (!part.body?.data && !part.body?.attachmentId) {
        console.log(`      ⚠️  Matched Content-ID but no image data found (mimeType: ${part.mimeType})`);
      }
    }
    
    // Also try partial match (in case of encoding differences)
    if (partCid.includes(targetCidClean) || targetCidClean.includes(partCid)) {
      if (part.body?.data) {
        const normalized = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
        return Buffer.from(normalized, "base64");
      }
    }
  }
  
  // Search in nested parts
  if (part.parts) {
    for (const nestedPart of part.parts) {
      const found = await findAttachmentByCid(gmail, messageId, nestedPart, targetCid, depth + 1, debug);
      if (found) return found;
    }
  }
  
  return null;
}
