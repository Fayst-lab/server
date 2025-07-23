import type { Request } from "express";

export function buildUrl(req: Request, ...parts: string[]): string {
  const baseUrl = `${req.protocol}://${req.get("host")}/${parts.join("/")}`;
  const cacheBuster = Date.now();
  return `${baseUrl}?v=${cacheBuster}`;
}
