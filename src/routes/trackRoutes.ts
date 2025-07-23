import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { upload } from "./uploadMiddleware";
import { GROUPS_DIR } from "../config/paths";
import { moveAndRename } from "../utils/fileUtils";
import { buildUrl } from "../utils/buildUrl";

export const trackRouter = Router();

trackRouter.post(
  "/uploadTrack",
  upload.fields([{ name: "cover" }, { name: "audio" }]),
  async (req, res) => {
    const { groupName, trackName } = req.body;
    const files = req.files as Record<string, Express.Multer.File[]>;
    const cover = files.cover?.[0];
    const audio = files.audio?.[0];

    if (!groupName || !trackName || !cover || !audio) {
      return res.status(400).json({ error: "Данные отсутствуют" });
    }

    const dir = path.join(GROUPS_DIR, groupName, "Tracks", trackName);
    await fs.mkdir(dir, { recursive: true });

    const coverDest = path.join(
      dir,
      `cover${path.extname(cover.originalname)}`
    );
    const audioDest = path.join(dir, audio.originalname);
    await Promise.all([
      moveAndRename(cover.path, coverDest),
      moveAndRename(audio.path, audioDest),
    ]);

    res.json({
      message: "Трек загружен",
      coverUrl: buildUrl(
        req,
        "groups",
        groupName,
        "Tracks",
        trackName,
        path.basename(coverDest)
      ),
      audioUrl: buildUrl(
        req,
        "groups",
        groupName,
        "Tracks",
        trackName,
        audio.originalname
      ),
    });
  }
);

trackRouter.get("/tracks/:groupName", async (req, res) => {
  const { groupName } = req.params;
  const { albumName } = req.query as Record<string, string>;
  const baseDir = albumName
    ? path.join(GROUPS_DIR, groupName, "Tracks", albumName)
    : path.join(GROUPS_DIR, groupName, "Tracks");

  let dirs;

  try {
    if (albumName) {
      dirs = [{ name: albumName, isDirectory: () => true }];
      await fs.access(baseDir);
    } else {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      dirs = entries.filter((d) => d.isDirectory());
    }
  } catch {
    return res.json([]);
  }

  const tracks = await Promise.all(
    dirs.map(async ({ name }) => {
      const files = await fs.readdir(path.join(baseDir, name));
      const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
      const audio = files.find((f) => path.parse(f).name === name);
      if (!audio) return null;
      return {
        trackName: name,
        coverUrl: cover
          ? buildUrl(req, "groups", groupName, "Tracks", name, cover)
          : null,
        audioUrl: buildUrl(req, "groups", groupName, "Tracks", name, audio),
      };
    })
  );

  res.json(tracks.filter(Boolean));
});
trackRouter.delete("/deleteTrack/:groupName/:trackName", async (req, res) => {
  const { groupName, trackName } = req.params;

  if (!groupName || !trackName) {
    return res.status(400).json({ error: "groupName и trackName обязательны" });
  }

  try {
    // Формируем путь с учётом groupName
    const trackFolderPath = path.join(
      GROUPS_DIR,
      groupName,
      "Tracks",
      trackName
    );

    console.log("Удаляем папку:", trackFolderPath);

    // Удаляем папку трека рекурсивно, force: true — игнорирует отсутствие папки
    await fs.rm(trackFolderPath, { recursive: true, force: true });

    res.json({
      message: `Папка трека "${trackName}" успешно удалена из Tracks группы "${groupName}"`,
    });
  } catch (error) {
    console.error("Ошибка при удалении папки трека из Tracks:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при удалении трека из Tracks" });
  }
});
// в тот же файл trackRouter.ts

trackRouter.get("/trackInfo/:groupName/:trackName", async (req, res) => {
  const { groupName, trackName } = req.params;
  const albumName = req.query.albumName as string | undefined;

  if (!groupName || !trackName) {
    return res.status(400).json({ error: "groupName и trackName обязательны" });
  }

  try {
    if (albumName) {
      // Поиск только в указанном альбоме
      const albumDir = path.join(GROUPS_DIR, groupName, "Albums", albumName);
      try {
        const files = await fs.readdir(albumDir);
        const audio = files.find(
          (f) =>
            f.toLowerCase().endsWith(".mp3") &&
            f.toLowerCase().includes(trackName.toLowerCase())
        );
        const cover = files.find((f) => f.toLowerCase().startsWith("cover."));

        if (audio) {
          return res.json({
            coverUrl: cover
              ? buildUrl(req, "groups", groupName, "Albums", albumName, cover)
              : null,
            audioUrl: buildUrl(
              req,
              "groups",
              groupName,
              "Albums",
              albumName,
              audio
            ),
          });
        }
      } catch {
        return res
          .status(404)
          .json({ error: "Трек не найден в указанном альбоме" });
      }
    } else {
      // 1) Пытаемся найти в Tracks
      try {
        const trackDir = path.join(GROUPS_DIR, groupName, "Tracks", trackName);
        const files = await fs.readdir(trackDir);
        const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
        const audio = files.find(
          (f) => path.extname(f).toLowerCase() === ".mp3"
        );

        if (audio) {
          return res.json({
            coverUrl: cover
              ? buildUrl(req, "groups", groupName, "Tracks", trackName, cover)
              : null,
            audioUrl: buildUrl(
              req,
              "groups",
              groupName,
              "Tracks",
              trackName,
              audio
            ),
          });
        }
      } catch {
        // Папки нет — пропускаем
      }

      // 2) Ищем во всех альбомах
      const albumsDir = path.join(GROUPS_DIR, groupName, "Albums");
      try {
        const albums = await fs.readdir(albumsDir, { withFileTypes: true });

        for (const alb of albums) {
          if (!alb.isDirectory()) continue;
          const albumDir = path.join(albumsDir, alb.name);
          try {
            const files = await fs.readdir(albumDir);
            const audio = files.find(
              (f) =>
                f.toLowerCase().endsWith(".mp3") &&
                f.toLowerCase().includes(trackName.toLowerCase())
            );
            const cover = files.find((f) =>
              f.toLowerCase().startsWith("cover.")
            );

            if (audio) {
              return res.json({
                coverUrl: cover
                  ? buildUrl(
                      req,
                      "groups",
                      groupName,
                      "Albums",
                      alb.name,
                      cover
                    )
                  : null,
                audioUrl: buildUrl(
                  req,
                  "groups",
                  groupName,
                  "Albums",
                  alb.name,
                  audio
                ),
              });
            }
          } catch {
            // папки не существует — пропускаем
          }
        }
      } catch {
        // Альбомов нет — ничего страшного
      }

      return res.status(404).json({ error: "Трек не найден" });
    }
  } catch (err) {
    console.error("Ошибка при получении информации о треке:", err);
    return res.status(500).json({ error: "Серверная ошибка" });
  }
});
