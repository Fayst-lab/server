import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { upload } from "./uploadMiddleware";
import { GROUPS_DIR } from "../config/paths";
import { moveAndRename } from "../utils/fileUtils";
import { buildUrl } from "../utils/buildUrl";

export const trackRouter = Router();

// Хелпер для построения пути и чтения папки с треками/альбомами
async function readDirSafe(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// Хелпер для поиска аудио и обложки в папке
async function getTrackFiles(baseDir: string, trackName: string | null = null) {
  const files = await fs.readdir(baseDir);
  const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
  let audio: string | undefined;

  if (trackName) {
    audio = files.find(
      (f) =>
        f.toLowerCase().endsWith(".mp3") &&
        f.toLowerCase().includes(trackName.toLowerCase())
    );
  } else {
    audio = files.find((f) => f.toLowerCase().endsWith(".mp3"));
  }

  return { cover, audio };
}

// Загрузка трека
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

// Получение всех треков из альбомов группы
trackRouter.get("/allTracks/:groupName", async (req, res) => {
  const groupName = req.params.groupName?.trim();
  if (!groupName)
    return res.status(400).json({ error: "groupName обязателен" });

  const albumsDir = path.join(GROUPS_DIR, groupName, "Albums");
  const albumEntries = await readDirSafe(albumsDir);
  if (!albumEntries)
    return res.status(404).json({ error: "Альбомы не найдены" });

  const tracks = [];

  for (const albumDir of albumEntries.filter((d) => d.isDirectory())) {
    const albumPath = path.join(albumsDir, albumDir.name);
    try {
      const files = await fs.readdir(albumPath);
      const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
      const audioFiles = files.filter((f) => f.toLowerCase().endsWith(".mp3"));

      for (const audioFile of audioFiles) {
        tracks.push({
          trackName: path.parse(audioFile).name,
          coverUrl: cover
            ? buildUrl(req, "groups", groupName, "Albums", albumDir.name, cover)
            : null,
          audioUrl: buildUrl(
            req,
            "groups",
            groupName,
            "Albums",
            albumDir.name,
            audioFile
          ),
          albumName: albumDir.name,
        });
      }
    } catch {
      // Пропускаем альбом, если ошибка
    }
  }

  res.json(tracks);
});

// Получение треков из Tracks или конкретного альбома
trackRouter.get("/tracks/:groupName", async (req, res) => {
  const { groupName } = req.params;
  const albumName = req.query.albumName as string | undefined;

  let dirs;
  const baseDir = albumName
    ? path.join(GROUPS_DIR, groupName, "Tracks", albumName)
    : path.join(GROUPS_DIR, groupName, "Tracks");

  try {
    if (albumName) {
      await fs.access(baseDir);
      dirs = [{ name: albumName, isDirectory: () => true }];
    } else {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      dirs = entries.filter((d) => d.isDirectory());
    }
  } catch {
    return res.json([]);
  }

  const tracks = await Promise.all(
    dirs.map(async ({ name }) => {
      const trackDir = path.join(baseDir, name);
      const { cover, audio } = await getTrackFiles(trackDir, name);
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

// Удаление трека
trackRouter.delete("/deleteTrack/:groupName/:trackName", async (req, res) => {
  const { groupName, trackName } = req.params;

  if (!groupName || !trackName) {
    return res.status(400).json({ error: "groupName и trackName обязательны" });
  }

  try {
    const trackFolderPath = path.join(
      GROUPS_DIR,
      groupName,
      "Tracks",
      trackName
    );
    await fs.rm(trackFolderPath, { recursive: true, force: true });
    res.json({
      message: `Трек "${trackName}" удалён из группы "${groupName}"`,
    });
  } catch (error) {
    console.error("Ошибка при удалении трека:", error);
    res.status(500).json({ error: "Ошибка сервера при удалении трека" });
  }
});

// Получение информации о треке (из Tracks или Albums)
trackRouter.get("/trackInfo/:groupName/:trackName", async (req, res) => {
  const { groupName, trackName } = req.params;
  const albumName = req.query.albumName as string | undefined;

  if (!groupName || !trackName) {
    return res.status(400).json({ error: "groupName и trackName обязательны" });
  }

  try {
    // Функция для поиска трека в указанной папке
    async function findTrackInDir(baseDir: string, trackName: string) {
      const files = await fs.readdir(baseDir);
      const audio = files.find(
        (f) =>
          f.toLowerCase().endsWith(".mp3") &&
          f.toLowerCase().includes(trackName.toLowerCase())
      );
      const cover = files.find((f) => f.toLowerCase().startsWith("cover."));
      if (!audio) return null;
      return { cover, audio };
    }

    if (albumName) {
      const albumDir = path.join(GROUPS_DIR, groupName, "Albums", albumName);
      const result = await findTrackInDir(albumDir, trackName);
      if (!result)
        return res.status(404).json({ error: "Трек не найден в альбоме" });
      return res.json({
        coverUrl: result.cover
          ? buildUrl(
              req,
              "groups",
              groupName,
              "Albums",
              albumName,
              result.cover
            )
          : null,
        audioUrl: buildUrl(
          req,
          "groups",
          groupName,
          "Albums",
          albumName,
          result.audio
        ),
      });
    }

    // 1) Поиск в Tracks
    const trackDir = path.join(GROUPS_DIR, groupName, "Tracks", trackName);
    try {
      const result = await findTrackInDir(trackDir, trackName);
      if (result) {
        return res.json({
          coverUrl: result.cover
            ? buildUrl(
                req,
                "groups",
                groupName,
                "Tracks",
                trackName,
                result.cover
              )
            : null,
          audioUrl: buildUrl(
            req,
            "groups",
            groupName,
            "Tracks",
            trackName,
            result.audio
          ),
        });
      }
    } catch {
      // пропускаем
    }

    // 2) Поиск по всем альбомам
    const albumsDir = path.join(GROUPS_DIR, groupName, "Albums");
    const albumEntries = await readDirSafe(albumsDir);
    if (albumEntries) {
      for (const albumDir of albumEntries.filter((d) => d.isDirectory())) {
        const albumPath = path.join(albumsDir, albumDir.name);
        try {
          const result = await findTrackInDir(albumPath, trackName);
          if (result) {
            return res.json({
              coverUrl: result.cover
                ? buildUrl(
                    req,
                    "groups",
                    groupName,
                    "Albums",
                    albumDir.name,
                    result.cover
                  )
                : null,
              audioUrl: buildUrl(
                req,
                "groups",
                groupName,
                "Albums",
                albumDir.name,
                result.audio
              ),
            });
          }
        } catch {
          // пропускаем
        }
      }
    }

    return res.status(404).json({ error: "Трек не найден" });
  } catch (error) {
    console.error("Ошибка при получении информации о треке:", error);
    res.status(500).json({ error: "Серверная ошибка" });
  }
});
