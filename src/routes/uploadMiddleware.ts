import multer from "multer";
import { TMP_DIR } from "../config/paths";

export const upload = multer({ dest: TMP_DIR });
