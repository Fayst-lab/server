import path from "path";

export const STATIC_DIR = path.resolve(process.cwd(), "static");
export const TMP_DIR = path.resolve(process.cwd(), "tmp");
export const GROUPS_DIR = path.join(STATIC_DIR, "groups");

// Функция, возвращающая путь к альбому
export const getAlbumPath = (groupName: string, albumName: string): string => {
  return path.join(GROUPS_DIR, groupName, "Albums", albumName);
};
