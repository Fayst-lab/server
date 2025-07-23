import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import { groupRouter } from "./routes/groupRoutes";
import { albumRouter } from "./routes/albumRoutes";
import { trackRouter } from "./routes/trackRoutes";
import { STATIC_DIR, TMP_DIR, GROUPS_DIR } from "./config/paths";
import type { Request, Response, NextFunction } from "express";

const app = express();
const PORT = 4001;

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173"],
    credentials: true,
  })
);
app.use("/static", express.static(STATIC_DIR));

// Добавляем статическую отдачу обложек групп
app.use(
  "/groups",
  express.static(GROUPS_DIR, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-cache");
    },
  })
);

app.use(express.json());

// Инициализация директорий
Promise.all([
  fs.mkdir(TMP_DIR, { recursive: true }),
  fs.mkdir(GROUPS_DIR, { recursive: true }),
]).catch(console.error);

// Подключение роутеров
app.use(groupRouter);
app.use(albumRouter);
app.use(trackRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal Server Error" });
});

app.listen(PORT, () => console.log(`🚀 Server at http://localhost:${PORT}`));
