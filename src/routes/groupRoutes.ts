import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { upload } from "./uploadMiddleware";
import { GROUPS_DIR } from "../config/paths";
import { moveAndRename, clearOldCovers } from "../utils/fileUtils";
import { buildUrl } from "../utils/buildUrl";

export const groupRouter = Router();

groupRouter.post(
  "/uploadGroupCover",
  upload.single("icon"),
  async (req, res) => {
    try {
      const { groupName } = req.body;
      const file = req.file;

      if (!groupName || !file) {
        return res.status(400).json({ error: "groupName и icon обязательны" });
      }

      const dir = path.join(GROUPS_DIR, groupName);
      await fs.mkdir(dir, { recursive: true });

      await clearOldCovers(dir);

      const ext = path.extname(file.originalname);
      const dest = path.join(dir, `cover${ext}`);

      await moveAndRename(file.path, dest);

      const url = buildUrl(req, "groups", groupName, `cover${ext}`);

      return res.json({ url });
    } catch (error) {
      console.error("Ошибка при загрузке обложки группы:", error);
      return res
        .status(500)
        .json({ error: "Ошибка сервера при загрузке обложки" });
    }
  }
);

groupRouter.get("/groupCover/:groupName", async (req, res) => {
  const { groupName } = req.params;
  const dir = path.join(GROUPS_DIR, groupName);
  const files = await fs.readdir(dir).catch(() => []);
  const cover = files.find((f) => f.startsWith("cover."));
  if (!cover) return res.status(404).json({ error: "Обложка не найдена" });
  res.json({ coverUrl: buildUrl(req, "groups", groupName, cover) });
});
