import fs from "fs/promises";
import path from "path";

export async function moveAndRename(src: string, dest: string) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
}

export async function clearOldCovers(dir: string) {
  const files = await fs.readdir(dir).catch(() => []);
  await Promise.all(
    files
      .filter((f) => f.startsWith("cover."))
      .map((f) => fs.unlink(path.join(dir, f)).catch(() => {}))
  );
}
