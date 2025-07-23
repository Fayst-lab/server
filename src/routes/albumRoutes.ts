import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { upload } from "./uploadMiddleware";
import { getAlbumPath, GROUPS_DIR } from "../config/paths";
import { moveAndRename } from "../utils/fileUtils";
import { buildUrl } from "../utils/buildUrl";
interface Track {
  path: string;
  originalname: string;
}
export const albumRouter = Router();

albumRouter.get("/albumCovers/:groupName", async (req, res) => {
  const { groupName } = req.params;
  const dir = path.join(GROUPS_DIR, groupName, "Albums");
  const dirs = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const result = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const files = await fs.readdir(path.join(dir, d.name));
        const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
        if (!cover) return null;
        return {
          coverUrl: buildUrl(req, "groups", groupName, "Albums", d.name, cover),
        };
      })
  );

  res.json(result.filter(Boolean));
});

albumRouter.post(
  "/uploadAlbum",
  upload.fields([{ name: "cover" }, { name: "tracks" }]),
  async (req, res) => {
    const { groupName, title: albumTitle } = req.body;
    const files = req.files as Record<string, Express.Multer.File[]>;
    const cover = files.cover?.[0];
    const tracks = files.tracks || [];

    if (!groupName || !albumTitle || !cover || !tracks.length) {
      return res.status(400).json({ error: "Обязательные данные отсутствуют" });
    }

    const base = path.join(GROUPS_DIR, groupName, "Albums", albumTitle);
    await fs.mkdir(base, { recursive: true });

    const coverDest = path.join(
      base,
      `cover${path.extname(cover.originalname)}`
    );
    await moveAndRename(cover.path, coverDest);

    const trackUrls: string[] = [];

    for (const t of tracks as Track[]) {
      const dest = path.join(base, t.originalname);
      await moveAndRename(t.path, dest);
      trackUrls.push(
        buildUrl(req, "groups", groupName, "Albums", albumTitle, t.originalname)
      );
    }

    res.json({
      message: "Альбом загружен",
      coverUrl: buildUrl(
        req,
        "groups",
        groupName,
        "Albums",
        albumTitle,
        path.basename(coverDest)
      ),
      tracksUrls: trackUrls,
    });
  }
);

albumRouter.get("/album-tracks/:groupName/:albumName", async (req, res) => {
  const { groupName, albumName } = req.params;
  const dir = path.join(GROUPS_DIR, groupName, "Albums", albumName);

  const files = await fs.readdir(dir).catch(() => []);
  const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
  const audioExts = [".mp3", ".wav", ".flac", ".ogg", ".m4a"];

  const tracks = files
    .filter((f) => audioExts.includes(path.extname(f).toLowerCase()))
    .map((f) => ({
      trackName: path.parse(f).name,
      audioUrl: buildUrl(req, "groups", groupName, "Albums", albumName, f),
    }));

  res.json({
    albumName,
    coverUrl: cover
      ? buildUrl(req, "groups", groupName, "Albums", albumName, cover)
      : null,
    tracks,
  });
});
albumRouter.delete("/deleteAlbum/:groupName/:albumName", async (req, res) => {
  const { groupName, albumName } = req.params;

  if (!groupName || !albumName) {
    return res.status(400).json({ error: "groupName и albumName обязательны" });
  }

  try {
    const albumPath = getAlbumPath(groupName, albumName);
    await fs.rm(albumPath, { recursive: true, force: true });

    return res.json({ message: `Альбом '${albumName}' удалён` });
  } catch (error) {
    console.error("Ошибка при удалении альбома:", error);
    return res
      .status(500)
      .json({ error: "Ошибка сервера при удалении альбома" });
  }
});
albumRouter.post(
  "/addTrack/:groupName/:albumName",
  upload.single("track"),
  async (req, res) => {
    const { groupName, albumName } = req.params;
    const file = req.file;

    if (!groupName || !albumName || !file) {
      return res
        .status(400)
        .json({ error: "groupName, albumName и файл трека обязательны" });
    }

    try {
      const albumPath = path.join(GROUPS_DIR, groupName, "Albums", albumName);

      // Проверяем, что папка альбома существует
      await fs.access(albumPath);

      // Путь для сохранения файла
      const trackDest = path.join(albumPath, file.originalname);

      // Перемещаем файл из временной папки
      await moveAndRename(file.path, trackDest);

      // Формируем URL для доступа к треку
      const trackUrl = buildUrl(
        req,
        "groups",
        groupName,
        "Albums",
        albumName,
        file.originalname
      );

      res.json({
        trackUrl,
      });
    } catch (error) {
      console.error("Ошибка при добавлении трека:", error);
      res.status(500).json({ error: "Ошибка сервера при добавлении трека" });
    }
  }
);
albumRouter.delete(
  "/deleteTrack/:groupName/:albumName/:trackName",
  async (req, res) => {
    const { groupName, albumName, trackName } = req.params;

    if (!groupName || !albumName || !trackName) {
      return res
        .status(400)
        .json({ error: "groupName, albumName и trackName обязательны" });
    }

    try {
      const albumDir = path.join(GROUPS_DIR, groupName, "Albums", albumName);

      // Читаем файлы альбома
      const files = await fs.readdir(albumDir);

      // Находим файл трека по имени без расширения
      const fileToDelete = files.find((file) => {
        const nameWithoutExt = path.parse(file).name;
        return nameWithoutExt === trackName;
      });

      if (!fileToDelete) {
        return res
          .status(404)
          .json({ error: "Файл трека не найден в альбоме" });
      }

      const filePath = path.join(albumDir, fileToDelete);

      // Проверяем доступность файла и удаляем
      await fs.access(filePath);
      await fs.unlink(filePath);

      res.json({
        message: `Трек "${trackName}" успешно удалён из альбома "${albumName}"`,
      });
    } catch (error) {
      console.error("Ошибка при удалении трека из альбома:", error);
      res
        .status(500)
        .json({ error: "Ошибка сервера при удалении трека из альбома" });
    }
  }
);
