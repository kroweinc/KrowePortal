import "server-only";
import { SOP_ALLOWED_EXTENSIONS } from "@/lib/attachments-constants";

// Extract readable text from an uploaded discovery-call transcript. The text
// IS the artifact the AI reads, so a transcript whose text can't be recovered
// is rejected rather than stored as an empty/garbled row.
//
// Supported: plain-text variants (.txt/.md/.vtt/.srt/.csv) read directly,
// .pdf via unpdf, .docx via mammoth. These libraries are dynamically imported
// so they only load on the server path that actually needs them.

export type ExtractResult = { text: string } | { error: string };

function getExt(fileName: string): string {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "");
}

const TEXT_LIKE = new Set([".txt", ".md", ".vtt", ".srt", ".csv"]);

export async function extractTranscriptText(file: File): Promise<ExtractResult> {
  const ext = getExt(file.name);
  if (!SOP_ALLOWED_EXTENSIONS.has(ext)) {
    return { error: "Unsupported transcript type. Use .txt, .md, .vtt, .srt, .csv, .pdf, or .docx." };
  }

  try {
    let text = "";

    if (TEXT_LIKE.has(ext)) {
      text = await file.text();
    } else if (ext === ".pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
    } else if (ext === ".docx") {
      const mammoth = (await import("mammoth")).default;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    }

    text = text.trim();
    if (!text) {
      return {
        error:
          "Couldn't read any text from that file. If it's a scanned/image PDF, paste the transcript text instead.",
      };
    }
    return { text };
  } catch (err) {
    console.error("[extractTranscriptText] failed", err);
    return { error: "Couldn't read that file. Try a different format or paste the text." };
  }
}
