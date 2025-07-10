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

// Создаём временную папку, если нет
fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

app.use("/static", express.static(STATIC_DIR));

// Multer загрузка в tmp, потом перемещение вручную
const tempStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: tempStorage });

// Загрузка обложки (пример)
app.post(
  "/uploadGroupCover",
  upload.single("icon"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "icon file is required" });
      }
      const groupName = req.body.groupName;
      if (!groupName) {
        return res.status(400).json({ error: "groupName is missing" });
      }

      const groupDir = path.join(GROUPS_DIR, groupName);
      await fs.mkdir(groupDir, { recursive: true });

      const ext = path.extname(req.file.originalname);
      const destPath = path.join(groupDir, `cover${ext}`);

      await fs.rename(req.file.path, destPath);

      const url = `/static/groups/${groupName}/cover${ext}`;
      console.log(`[${new Date().toISOString()}] Uploaded cover: ${url}`);

      res.json({ url });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
app.get("/groupCover/:groupName", async (req: Request, res: Response) => {
  const { groupName } = req.params;

  if (!groupName) {
    return res.status(400).json({ error: "groupName is required" });
  }

  const folderPath = path.join(GROUPS_DIR, groupName);

  try {
    // Проверим, что папка существует
    await fs.access(folderPath);

    // Найдем файл cover с любым расширением в папке
    const files = await fs.readdir(folderPath);
    const coverFile = files.find((f) => f.startsWith("cover."));

    if (!coverFile) {
      return res.status(404).json({ error: "Cover image not found" });
    }

    const filePath = path.join(folderPath, coverFile);

    // Отправляем сам файл с корректным Content-Type
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(404).json({ error: "Group folder not found" });
  }
});
// Загрузка трека с обложкой
app.post(
  "/uploadTrack",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      console.log(
        `[${new Date().toISOString()}] Запрос на загрузку трека получен`
      );

      const groupName = req.body.groupName;
      const trackName = req.body.trackName;

      console.log(
        `Получены данные: groupName="${groupName}", trackName="${trackName}"`
      );

      if (!groupName || !trackName) {
        console.warn(
          `[${new Date().toISOString()}] Ошибка: groupName и trackName обязательны`
        );
        return res
          .status(400)
          .json({ error: "groupName and trackName are required" });
      }

      const files = req.files as {
        cover?: Express.Multer.File[];
        audio?: Express.Multer.File[];
      };

      if (!files?.cover?.[0] || !files?.audio?.[0]) {
        console.warn(
          `[${new Date().toISOString()}] Ошибка: отсутствуют cover или audio файлы`
        );
        return res
          .status(400)
          .json({ error: "cover and audio files are required" });
      }

      console.log(
        `Файлы получены: cover="${files.cover[0].originalname}", audio="${files.audio[0].originalname}"`
      );

      // Путь для трека
      const trackDir = path.join(GROUPS_DIR, groupName, "Tracks", trackName);
      console.log(`Проверка существования папки для трека: ${trackDir}`);

      try {
        // Проверяем существует ли папка
        await fs.access(trackDir);
        // Если нет ошибки, значит папка существует
        console.warn(
          `[${new Date().toISOString()}] Ошибка: трек с таким названием уже существует`
        );
        return res
          .status(409)
          .json({ error: "Трек с таким названием уже существует" });
      } catch {
        // Ошибка доступа — значит папки нет, можно создавать
      }

      // Создаем папку для трека
      await fs.mkdir(trackDir, { recursive: true });

      // Перемещаем cover
      const coverFile = files.cover[0];
      const coverExt = path.extname(coverFile.originalname);
      const coverDest = path.join(trackDir, `cover${coverExt}`);
      await fs.rename(coverFile.path, coverDest);
      console.log(`Обложка перемещена в: ${coverDest}`);

      // Перемещаем audio
      const audioFile = files.audio[0];
      const audioDest = path.join(trackDir, audioFile.originalname);
      await fs.rename(audioFile.path, audioDest);
      console.log(`Аудио перемещено в: ${audioDest}`);

      const coverUrl = `/static/groups/${groupName}/Tracks/${trackName}/cover${coverExt}`;
      const audioUrl = `/static/groups/${groupName}/Tracks/${trackName}/${audioFile.originalname}`;

      console.log(
        `[${new Date().toISOString()}] Трек успешно загружен: ${trackName} для группы: ${groupName}`
      );

      res.json({
        message: "Upload successful",
        coverUrl,
        audioUrl,
      });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Ошибка при загрузке трека:`,
        error
      );
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
