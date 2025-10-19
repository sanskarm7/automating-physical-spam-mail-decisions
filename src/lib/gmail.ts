
import { google } from "googleapis";

export function getGmailClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function listDigestMessages(gmail: ReturnType<typeof getGmailClient>, query: string) {
  const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 25 });
  return res.data.messages ?? [];
}

export async function getMessageHtml(gmail: ReturnType<typeof getGmailClient>, id: string): Promise<string | null> {
  const full = await gmail.users.messages.get({ userId: "me", id });
  const html = extractHtml(full.data.payload) || extractHtmlFromParts(full.data.payload?.parts || []);
  return html;
}

function extractHtml(payload: any): string | null {
  if (!payload) return null;
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeB64(payload.body.data);
  }
  return null;
}

function extractHtmlFromParts(parts: any[]): string | null {
  for (const p of parts ?? []) {
    if (p.mimeType === "text/html" && p.body?.data) return decodeB64(p.body.data);
    if (p.parts) {
      const inner = extractHtmlFromParts(p.parts);
      if (inner) return inner;
    }
  }
  return null;
}

function decodeB64(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, "base64").toString("utf8");
}
