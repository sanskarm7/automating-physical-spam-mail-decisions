import { google, gmail_v1 } from "googleapis";

type GmailClient = gmail_v1.Gmail;

export function getGmailClient(accessToken: string): GmailClient {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2 });
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
  const msg = await gmail.users.messages.get({ userId: "me", id });
  const payload = msg.data.payload;
  if (!payload) return null;

  return (
    extractHtmlFromPayload(payload) ||
    extractHtmlFromParts(payload.parts ?? [])
  );
}

function extractHtmlFromPayload(
  part: gmail_v1.Schema$MessagePart
): string | null {
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeText(part.body.data);
  }
  return null;
}

function extractHtmlFromParts(
  parts: gmail_v1.Schema$MessagePart[]
): string | null {
  for (const part of parts) {
    const direct = extractHtmlFromPayload(part);
    if (direct) return direct;

    if (part.parts?.length) {
      const nested = extractHtmlFromParts(part.parts);
      if (nested) return nested;
    }
  }
  return null;
}

function decodeText(b64: string): string {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function decodeToBuffer(b64: string): Buffer {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

/**
 * Extract an inline image by Content-ID.
 * Returns a Buffer or null if the image is not found.
 */
export async function getImageByCid(
  gmail: GmailClient,
  messageId: string,
  cid: string
): Promise<Buffer | null> {
  const contentId = cid.replace(/^cid:/i, "").replace(/[<>]/g, "").trim();
  if (!contentId) {
    console.log(`Invalid or empty Content-ID: ${cid}`);
    return null;
  }

  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = msg.data.payload;
  if (!payload) {
    console.log(`Message ${messageId} has no payload`);
    return null;
  }

  const debug = !process.env.DISABLE_DEBUG_LOGGING;

  return (
    (await findAttachmentByCid(
      gmail,
      messageId,
      payload,
      contentId,
      0,
      debug
    )) || null
  );
}

async function findAttachmentByCid(
  gmail: GmailClient,
  messageId: string,
  part: gmail_v1.Schema$MessagePart,
  targetCid: string,
  depth: number,
  debug: boolean
): Promise<Buffer | null> {
  if (depth > 10) return null;

  const headers = part.headers ?? [];
  const cidHeader = headers.find(
    (h) => h.name?.toLowerCase() === "content-id"
  );

  if (cidHeader?.value) {
    const partCid = cidHeader.value.replace(/[<>]/g, "").trim();
    const target = targetCid.trim();

    if (debug && depth === 0) {
      console.log(`Found Content-ID header: ${partCid}, looking for ${target}`);
    }

    const matches =
      partCid === target ||
      partCid === `<${target}>` ||
      target === `<${partCid}>` ||
      partCid.includes(target) ||
      target.includes(partCid);

    if (matches) {
      if (part.body?.data) {
        return decodeToBuffer(part.body.data);
      }

      if (part.body?.attachmentId) {
        try {
          const attachment = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId,
            id: part.body.attachmentId,
          });

          if (attachment.data?.data) {
            return decodeToBuffer(attachment.data.data);
          }
        } catch (err) {
          console.log(
            `Failed to fetch attachment ${part.body.attachmentId}:`,
            err
          );
        }
      }

      console.log(
        `Matched Content-ID but no image data (mimeType=${part.mimeType})`
      );
    }
  }

  if (part.parts?.length) {
    for (const nested of part.parts) {
      const found = await findAttachmentByCid(
        gmail,
        messageId,
        nested,
        targetCid,
        depth + 1,
        debug
      );
      if (found) return found;
    }
  }

  return null;
}
