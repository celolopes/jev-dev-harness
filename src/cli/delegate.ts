import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { MAX_DELEGATE_INPUT_BYTES, incompleteDelegateReceipt, reviewDelegateJson } from "../delegate/index.js";

async function readInput(source: string): Promise<Buffer | null> {
  if (source === "-") {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > MAX_DELEGATE_INPUT_BYTES) return null;
      chunks.push(data);
    }
    return Buffer.concat(chunks);
  }
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsupported input file");
  if (info.size > MAX_DELEGATE_INPUT_BYTES) return null;
  const file = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("Input file changed during opening");
    const data = Buffer.alloc(MAX_DELEGATE_INPUT_BYTES + 1);
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await file.read(data, total, data.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total > MAX_DELEGATE_INPUT_BYTES ? null : data.subarray(0, total);
  } finally { await file.close(); }
}
export async function runDelegateReview(options: { input?: string } = {}): Promise<void> {
  let receipt: Awaited<ReturnType<typeof reviewDelegateJson>>;
  try {
    const data = await readInput(options.input || "-");
    if (data === null) receipt = incompleteDelegateReceipt("INPUT_TOO_LARGE");
    else {
      try { receipt = await reviewDelegateJson(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
      catch { receipt = incompleteDelegateReceipt("INVALID_INPUT"); }
    }
  } catch { receipt = incompleteDelegateReceipt("INPUT_UNAVAILABLE"); }
  console.log(JSON.stringify(receipt));
  process.exitCode = receipt.exitCode;
}
