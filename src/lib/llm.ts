// llm.ts
//
// Lightweight LLM interpreter for OCR mail results.
// No predefined categories. No hardcoding. No assumptions.
// Gemini simply describes the mail in its own words.

import { GoogleGenAI } from "@google/genai";
import type { OcrResult } from "./ocr";

export interface MailInterpretation {
  senderName: string | null;       // 0–1 confidence Gemini has in the sender
  mailType: string;           // free-form label e.g. "insurance flyer", "bank notice", "advertising mailer"
  shortSummary: string;       // 1–2 sentence human explanation
  isImportant: boolean;       // does this look time-sensitive or financially relevant?
  importanceReason: string;   // why Gemini decided that
  rawJson?: any;
}

export interface GeminiInterpretOptions {
  model?: string;
  temperature?: number;
}

// defaults
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_TEMP = 0.15;

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

export async function interpretMailWithGemini(
  ocr: OcrResult,
  opts: GeminiInterpretOptions = {}
): Promise<MailInterpretation> {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY");
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMP;

  const prompt = `
You are analyzing OCR text extracted from a physical US mail piece.

Your job:
1. Identify the sender name if possible. If unclear, set "senderName" to null.
2. Provide a confidence score (0–1) for your sender guess.
3. Provide a free-form label "mailType" describing what kind of mail this is,
   in natural language. Examples (just examples, you are NOT limited to these):
   - "insurance solicitation"
   - "credit card offer"
   - "bank statement"
   - "advertising flyer"
   - "medical billing notice"
   - "political advertisement"
   - "personal mail"
   - "unclear"
4. Provide a short one–two sentence human-friendly summary.
5. Decide if this mail is important to a typical recipient.
6. Explain in plain English why or why not.

STRICT FORMAT RULES:
- Respond with ONLY a single JSON object, no extra text, no markdown.
- JSON must match this exact shape:

{
  "senderName": string | null,
  "mailType": string,
  "shortSummary": string,
  "isImportant": boolean,
  "importanceReason": string
}

- Do NOT add any other fields.
- Do NOT include double quote (") characters inside string values. If you need quotes, use single quotes (').
- Keep "shortSummary" under 200 characters.
- Keep "importanceReason" under 200 characters.
- Do not include line breaks inside any string values.

Here is the OCR result as JSON:

${JSON.stringify(ocr, null, 2)}
`.trim();

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature,
      maxOutputTokens: 600,
    },
  });

  const text = response.text?.trim();

  if (!text) {
    console.error("Gemini returned no text");
    return {
      senderName: null,
      mailType: "unknown",
      shortSummary: "LLM returned no analysis for this mail piece.",
      isImportant: false,
      importanceReason: "No LLM output was returned.",
      rawJson: null,
    };
  }

  const json = safeParseJSON(text);

  if (!json || typeof json !== "object") {
    console.error("Gemini JSON parse failed, falling back to generic interpretation");
    return {
      senderName: null,
      mailType: "unknown",
      shortSummary: "LLM could not reliably interpret this mail piece.",
      isImportant: false,
      importanceReason: "Failed to parse LLM JSON response.",
      rawJson: json,
    };
  }

  return {
    senderName: json.senderName ?? null,
    mailType: String(json.mailType ?? "unknown"),
    shortSummary: String(json.shortSummary ?? ""),
    isImportant: Boolean(json.isImportant),
    importanceReason: String(json.importanceReason ?? ""),
    rawJson: json,
  };
}

function safeParseJSON(str: string): any | null {
  let cleaned = str.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
    const idx = cleaned.lastIndexOf("```");
    if (idx !== -1) cleaned = cleaned.slice(0, idx);
    cleaned = cleaned.trim();
  }

  // Try to isolate the JSON object if there's extra noise
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1).trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse Gemini JSON:", cleaned, err);
    return null;
  }
}
