import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { adminMiddleware } from "../auth";

const DATA_DIR = path.resolve(process.cwd(), ".data", "ventures");
const FILES_DIR = path.join(DATA_DIR, "files");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

fs.mkdirSync(FILES_DIR, { recursive: true });

export interface VentureFile {
  id: string;
  originalName: string;
  storedName: string;
  category: string;
  description: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

function readIndex(): VentureFile[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as VentureFile[];
  } catch {
    return [];
  }
}

function writeIndex(files: VentureFile[]): void {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(files, null, 2), "utf-8");
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILES_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/csv",
      "text/plain",
      "application/zip",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

const router = Router();

router.get("/ventures/files", adminMiddleware, (_req, res): void => {
  const files = readIndex();
  res.json(files);
});

router.post(
  "/ventures/files",
  adminMiddleware,
  upload.single("file"),
  (req, res): void => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const category = typeof req.body.category === "string" ? req.body.category : "General";
    const description = typeof req.body.description === "string" ? req.body.description : "";
    const entry: VentureFile = {
      id: randomUUID(),
      originalName: req.file.originalname,
      storedName: req.file.filename,
      category,
      description,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
    };
    const files = readIndex();
    files.unshift(entry);
    writeIndex(files);
    req.log.info({ fileId: entry.id, category }, "Venture file uploaded");
    res.status(201).json(entry);
  },
);

router.get("/ventures/files/:fileId", adminMiddleware, (req, res): void => {
  const rawId = Array.isArray(req.params.fileId)
    ? req.params.fileId[0]
    : req.params.fileId;
  const files = readIndex();
  const entry = files.find((f) => f.id === rawId);
  if (!entry) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const filePath = path.join(FILES_DIR, entry.storedName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }
  res.setHeader("Content-Type", entry.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(entry.originalName)}"`,
  );
  res.setHeader("Content-Length", entry.size);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

router.delete("/ventures/files/:fileId", adminMiddleware, (req, res): void => {
  const rawId = Array.isArray(req.params.fileId)
    ? req.params.fileId[0]
    : req.params.fileId;
  const files = readIndex();
  const idx = files.findIndex((f) => f.id === rawId);
  if (idx === -1) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const [entry] = files.splice(idx, 1);
  writeIndex(files);
  const filePath = path.join(FILES_DIR, entry!.storedName);
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  req.log.info({ fileId: entry!.id }, "Venture file deleted");
  res.sendStatus(204);
});

export default router;
