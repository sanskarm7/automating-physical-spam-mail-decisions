// ocr.ts
//
// Pure OCR extractor using Tesseract.js.
// No hardcoded heuristics.
// No filtering.
// No assumptions about sender, address, postage, etc.
//
// This is what you want to pass into an LLM for a second-stage classifier
// so the LLM can interpret the lines semantically.

import sharp from "sharp";
import type { Worker as TesseractWorker, RecognizeResult } from "tesseract.js";

type ImageInput = Buffer | string;

export type OcrLine = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type OcrResult = {
  rawText: string;
  normalizedText: string;
  lines: OcrLine[];
};

let tesseractModule: typeof import("tesseract.js") | null = null;
let worker: TesseractWorker | null = null;

async function getTesseract() {
  if (!tesseractModule) {
    tesseractModule = await import("tesseract.js");
  }
  return tesseractModule;
}

async function getWorker(): Promise<TesseractWorker> {
  if (worker) return worker;

  const { createWorker } = await getTesseract();
  worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "error") console.error("Tesseract error:", m);
    },
  });

  await worker.setParameters({
    tessedit_pageseg_mode: 3 as any,
    preserve_interword_spaces: "1",
  });

  return worker;
}

async function preprocess(image: ImageInput): Promise<Buffer | string> {
  if (typeof image === "string") return image;
  return sharp(image).grayscale().normalize().sharpen().toBuffer();
}

/**
 * Run OCR and return all recovered text + bounding boxes.
 * Absolutely NO filtering, no scoring, no heuristics.
 */
export async function runOcr(image: ImageInput): Promise<OcrResult> {
  const w = await getWorker();
  const input = await preprocess(image);

  const result: RecognizeResult = await w.recognize(input);

  const rawText = result.data.text ?? "";
  const normalizedText = normalizeWhitespace(rawText);

  const lines: OcrLine[] = (result.data.lines ?? []).map((l: any) => ({
    text: normalizeWhitespace(l.text ?? ""),
    x0: l.bbox?.x0 ?? 0,
    y0: l.bbox?.y0 ?? 0,
    x1: l.bbox?.x1 ?? 0,
    y1: l.bbox?.y1 ?? 0,
  }));

  // Log everything so you see *exactly* what the LLM will receive
  console.log("=== OCR RAW TEXT ===\n", rawText);
  console.log("\n=== OCR NORMALIZED ===\n", normalizedText);
  console.log("\n=== OCR LINES ===");
  lines.forEach((l, i) => {
    console.log(
      `[${i}] "${l.text}" | bbox=(${l.x0},${l.y0}) → (${l.x1},${l.y1})`
    );
  });

  return { rawText, normalizedText, lines };
}

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

export async function shutdownOcr(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
