import express, { Request, Response } from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs/promises";
import path from "path";

const app = express();
const PORT = 4001;

const STATIC_DIR = path.resolve(process.cwd(), "static");
const GROUPS_DIR = path.join(STATIC_DIR, "groups");
const TMP_DIR = path.resolve(process.cwd(), "tmp");

// Создаём временную папку для multer, если не существует
fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173"], // клиент Vite
    credentials: true,
  })
);

// Статичные файлы: доступ к /static
app.use("/static", express.static(STATIC_DIR));

// Настройка multer — загрузка во временную папку
const tempStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage: tempStorage });
/**
 * GET /albumCover/:groupName/:albumTitle
 * Возвращает файл обложки альбома
 */
app.get("/albumCovers/:groupName", async (req: Request, res: Response) => {
  const { groupName } = req.params;
  if (!groupName) {
    return res.status(400).json({ error: "groupName обязателен" });
  }

  const groupAlbumsDir = path.join(GROUPS_DIR, groupName, "Albums");

  try {
    await fs.access(groupAlbumsDir);
    const albumDirs = await fs.readdir(groupAlbumsDir, { withFileTypes: true });

    // Фильтруем только директории (альбомы)
    const albums = albumDirs.filter((d) => d.isDirectory());

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    // Проходим по каждой папке альбома и ищем cover.*
    const covers = await Promise.all(
      albums.map(async (albumDir) => {
        const albumPath = path.join(groupAlbumsDir, albumDir.name);
        const files = await fs.readdir(albumPath);
        const coverFile = files.find((f) =>
          f.toLowerCase().startsWith("cover.")
        );
        if (!coverFile) return null;

        return {
          albumTitle: albumDir.name,
          coverUrl: `${baseUrl}/static/groups/${encodeURIComponent(
            groupName
          )}/Albums/${encodeURIComponent(albumDir.name)}/${encodeURIComponent(
            coverFile
          )}`,
        };
      })
    );

    // Убираем null (альбомы без обложек)
    const filtered = covers.filter(
      (c): c is { albumTitle: string; coverUrl: string } => c !== null
    );

    res.json(filtered);
  } catch (e) {
    console.error("Ошибка при получении обложек альбомов:", e);
    res.status(404).json({ error: "Группа или альбомы не найдены" });
  }
});

/**
 * POST /uploadAlbum
 * Создаёт папку static/groups/{groupName}/Albums/{albumTitle}
 * и сохраняет в неё файл cover и все треки
 * Ожидает поля:
 *  - groupName: string
 *  - title: string  (название альбома)
 *  - файлы cover (name="cover") и tracks (name="tracks")
 */
app.post(
  "/uploadAlbum",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "tracks", maxCount: 100 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { groupName, title: albumTitle } = req.body;
      if (!groupName || !albumTitle) {
        return res.status(400).json({ error: "groupName и title обязательны" });
      }

      const files = req.files as {
        cover?: Express.Multer.File[];
        tracks?: Express.Multer.File[];
      };

      const coverFile = files.cover?.[0];
      const trackFiles = files.tracks || [];

      if (!coverFile) {
        return res.status(400).json({ error: "Необходимо загрузить cover" });
      }
      if (trackFiles.length === 0) {
        return res
          .status(400)
          .json({ error: "Необходимо загрузить хотя бы один трек" });
      }

      // Путь к папке Album
      const albumDir = path.join(GROUPS_DIR, groupName, "Albums", albumTitle);
      await fs.mkdir(albumDir, { recursive: true });

      // Сохраняем cover
      const coverExt = path.extname(coverFile.originalname);
      const coverDest = path.join(albumDir, `cover${coverExt}`);
      await fs.rename(coverFile.path, coverDest);

      // Сохраняем треки
      await Promise.all(
        trackFiles.map((file) => {
          const dest = path.join(albumDir, file.originalname);
          return fs.rename(file.path, dest);
        })
      );

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const coverUrl = `${baseUrl}/static/groups/${groupName}/Albums/${encodeURIComponent(
        albumTitle
      )}/cover${coverExt}`;
      const tracksUrls = trackFiles.map(
        (f) =>
          `${baseUrl}/static/groups/${groupName}/Albums/${encodeURIComponent(
            albumTitle
          )}/${encodeURIComponent(f.originalname)}`
      );

      return res.json({
        message: "Альбом успешно загружен",
        coverUrl,
        tracksUrls,
      });
    } catch (error) {
      console.error("Ошибка при загрузке альбома:", error);
      return res.status(500).json({ error: "Внутренняя ошибка сервера" });
    }
  }
);
/**
 * POST /uploadGroupCover
 * Загрузка обложки группы
 * Принимает файл "icon" и поле "groupName"
 * Сохраняет в static/groups/{groupName}/cover.{ext}
 * Возвращает url загруженной обложки
 */
app.post(
  "/uploadGroupCover",
  upload.single("icon"),
  async (req: Request, res: Response) => {
    const groupName = req.body.groupName;
    const file = req.file;

    console.log(`[${new Date().toISOString()}] POST /uploadGroupCover called`);
    console.log(`Received groupName: ${groupName}`);
    console.log(`Received file: ${file ? file.originalname : "none"}`);

    if (!groupName) {
      console.warn(`[${new Date().toISOString()}] groupName is missing`);
      return res.status(400).json({ error: "groupName is missing" });
    }
    if (!file) {
      console.warn(`[${new Date().toISOString()}] icon file is missing`);
      return res.status(400).json({ error: "icon file is required" });
    }

    try {
      const groupDir = path.join(GROUPS_DIR, groupName);
      console.log(
        `[${new Date().toISOString()}] Creating directory: ${groupDir}`
      );
      await fs.mkdir(groupDir, { recursive: true });

      // Удаляем все cover.* файлы
      const files = await fs.readdir(groupDir);
      const coverFiles = files.filter((f) => f.startsWith("cover."));
      console.log(
        `[${new Date().toISOString()}] Found cover files to delete: ${coverFiles.join(
          ", "
        )}`
      );
      await Promise.all(
        coverFiles.map((fileName) =>
          fs.unlink(path.join(groupDir, fileName)).catch((e) => {
            console.error(
              `[${new Date().toISOString()}] Error deleting file ${fileName}:`,
              e
            );
          })
        )
      );

      // Сохраняем новый файл
      const ext = path.extname(file.originalname);
      const destPath = path.join(groupDir, `cover${ext}`);
      console.log(
        `[${new Date().toISOString()}] Moving uploaded file to: ${destPath}`
      );
      await fs.rename(file.path, destPath);

      const url = `http://localhost:4001/static/groups/${groupName}/cover${ext}`;
      console.log(`[${new Date().toISOString()}] Uploaded cover URL: ${url}`);
      res.json({ url });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Upload error:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /tracks/:groupName
 * Возвращает список треков группы с url для обложки и аудио
 */
app.get("/tracks/:groupName", async (req: Request, res: Response) => {
  const { groupName } = req.params;
  const { albumName } = req.query; // необязательный параметр

  if (!groupName)
    return res.status(400).json({ error: "groupName is required" });

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const tracksDir = path.join(GROUPS_DIR, groupName, "Tracks");

  try {
    await fs.access(tracksDir);

    let dirs;
    if (typeof albumName === "string" && albumName.trim() !== "") {
      // Если albumName передан — читаем только папку альбома
      const albumPath = path.join(tracksDir, albumName);
      await fs.access(albumPath); // проверка существования

      dirs = [{ name: albumName, isDirectory: () => true }];
    } else {
      // Иначе читаем все папки с треками
      dirs = await fs.readdir(tracksDir, { withFileTypes: true });
      dirs = dirs.filter((d) => d.isDirectory());
    }

    const tracks = await Promise.all(
      dirs.map(async ({ name }) => {
        const trackPath = path.join(tracksDir, name);
        const files = await fs.readdir(trackPath);

        const coverFile = files.find((f) =>
          f.toLowerCase().startsWith("cover.")
        );
        const audioFile = files.find((f) => path.parse(f).name === name);

        if (!audioFile) {
          console.warn(`Audio file missing for track "${name}"`);
          return null;
        }

        return {
          trackName: name,
          coverUrl: coverFile
            ? `${baseUrl}/static/groups/${groupName}/Tracks/${name}/${coverFile}`
            : null,
          audioUrl: `${baseUrl}/static/groups/${groupName}/Tracks/${name}/${audioFile}`,
        };
      })
    );

    res.json(tracks.filter(Boolean));
  } catch (e) {
    console.error("Error reading tracks:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get(
  "/album-tracks/:groupName/:albumName",
  async (req: Request, res: Response) => {
    const { groupName, albumName } = req.params;

    if (!groupName || !albumName) {
      return res
        .status(400)
        .json({ error: "groupName и albumName обязательны" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const albumDir = path.join(GROUPS_DIR, groupName, "Albums", albumName);

    try {
      // Проверяем существование папки альбома
      await fs.access(albumDir);

      // Список файлов внутри альбома
      const files = await fs.readdir(albumDir);

      // Ищем обложку — файл начинающийся с cover.
      const coverFile = files.find((f) => f.toLowerCase().startsWith("cover."));
      const coverUrl = coverFile
        ? `${baseUrl}/static/groups/${groupName}/Albums/${albumName}/${coverFile}`
        : null;

      // Считаем треками все файлы аудио — например с расширениями mp3, wav и т.п.
      // Фильтруем по расширениям аудио (можно добавить нужные)
      const audioExtensions = [".mp3", ".wav", ".flac", ".ogg", ".m4a"];
      const tracks = files
        .filter((f) => audioExtensions.includes(path.extname(f).toLowerCase()))
        .map((audioFile) => ({
          trackName: path.parse(audioFile).name,
          audioUrl: `${baseUrl}/static/groups/${groupName}/Albums/${albumName}/${audioFile}`,
        }));

      res.json({
        albumName,
        coverUrl,
        tracks,
      });
    } catch (e) {
      console.error("Error reading album tracks:", e);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /groupCover/:groupName
 * Отдаёт файл обложки группы
 */
app.get("/groupCover/:groupName", async (req: Request, res: Response) => {
  const { groupName } = req.params;

  if (!groupName) {
    return res.status(400).json({ error: "groupName is required" });
  }

  const folderPath = path.join(GROUPS_DIR, groupName);

  try {
    await fs.access(folderPath);

    const files = await fs.readdir(folderPath);
    const coverFile = files.find((f) => f.startsWith("cover."));

    if (!coverFile) {
      return res.status(404).json({ error: "Cover image not found" });
    }

    const coverUrl = `http://localhost:4001/static/groups/${groupName}/${coverFile}`;

    return res.json({ coverUrl });
  } catch {
    return res.status(404).json({ error: "Group folder not found" });
  }
});

/**
 * POST /uploadTrack
 * Загрузка трека с обложкой
 * Принимает файлы "cover" и "audio" + поля groupName и trackName
 * Создаёт папку static/groups/{groupName}/Tracks/{trackName}
 * Сохраняет cover как cover.{ext}, audio с оригинальным именем
 */
app.post(
  "/uploadTrack",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { groupName, trackName } = req.body;

      if (!groupName || !trackName) {
        return res.status(400).json({
          error: "Необходимо указать имя группы и название трека",
        });
      }

      const files = req.files as {
        cover?: Express.Multer.File[];
        audio?: Express.Multer.File[];
      };

      if (!files?.cover?.[0] || !files?.audio?.[0]) {
        return res.status(400).json({
          error: "Необходимы файлы обложки и аудио",
        });
      }

      const trackDir = path.join(GROUPS_DIR, groupName, "Tracks", trackName);

      try {
        await fs.access(trackDir);
        return res.status(409).json({
          error: "Трек с таким названием уже существует",
        });
      } catch {
        // Папки ещё не существует, всё ок
      }

      await fs.mkdir(trackDir, { recursive: true });

      const coverFile = files.cover[0];
      const audioFile = files.audio[0];

      const coverExt = path.extname(coverFile.originalname);
      const coverDest = path.join(trackDir, `cover${coverExt}`);
      const audioDest = path.join(trackDir, audioFile.originalname);

      await Promise.all([
        fs.rename(coverFile.path, coverDest),
        fs.rename(audioFile.path, audioDest),
      ]);

      return res.json({
        message: "Трек успешно загружен",
        coverUrl: `http://localhost:4001/static/groups/${groupName}/Tracks/${trackName}/cover${coverExt}`,
        audioUrl: `http://localhost:4001/static/groups/${groupName}/Tracks/${trackName}/${audioFile.originalname}`,
      });
    } catch (error) {
      console.error("Ошибка при загрузке трека:", error);
      return res.status(500).json({
        error: "Внутренняя ошибка сервера. Попробуйте позже",
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
