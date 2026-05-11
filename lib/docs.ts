import { promises as fs } from "node:fs";
import path from "node:path";

export async function readDoc(file: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", file), "utf-8");
}
