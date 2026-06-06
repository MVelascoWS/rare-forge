import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * POST /api/upload  (multipart/form-data, field "file")
 *
 * Saves one uploaded image to ./uploads/<uuid>-<filename> and returns
 * { path } — a path relative to the project root that the backend process can
 * hand to `rare mint --image` (the smoke tests confirmed relative paths like
 * test-assets/... resolve from the app's cwd).
 *
 * Serves BOTH the artist's asset delivery and the producer's work cover at seal
 * time. Local disk only — no cloud storage (FRONTEND_SPEC "Upload endpoint").
 * The dir must be writable by the app and readable by the rare-cli invocation,
 * which holds here because both run in the same process/host.
 */

// Route handlers default to the Node.js runtime; make it explicit since we use fs.
export const runtime = "nodejs";

const UPLOAD_DIR = "uploads"; // relative to process.cwd()
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — game-dev assets can be large

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 }
    );
  }

  // Any file type is accepted (#3): images become NFT media directly; other
  // assets (FBX, audio, …) are stored + served, with an image used for the mint.

  // Sanitize the original name to a safe basename; prefix a uuid for uniqueness.
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${randomUUID()}-${safeName}`;
  const relPath = `${UPLOAD_DIR}/${fileName}`;
  const absDir = path.join(process.cwd(), UPLOAD_DIR);
  const absPath = path.join(absDir, fileName);

  try {
    await mkdir(absDir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(absPath, bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `Failed to save upload: ${message}` },
      { status: 500 }
    );
  }

  // `path` (disk, relative) is what callers pass as deliveryPath / imagePath to
  // the backend (rare --image). `url` is what the browser uses to preview /
  // download the file (served by /api/files).
  return NextResponse.json({
    path: relPath,
    url: `/api/files/${fileName}`,
    filename: safeName,
    contentType: file.type || "application/octet-stream",
    isImage: file.type.startsWith("image/"),
  });
}
