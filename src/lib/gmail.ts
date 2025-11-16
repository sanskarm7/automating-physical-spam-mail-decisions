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
