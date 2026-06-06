/**
 * Helpers for uploaded-file display. The backend keeps the disk path (for
 * `rare mint --image`); the browser reads files through the served URL
 * (/api/files/<name>). See /api/upload and /api/files.
 */

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
]);

export function ext(path: string | null | undefined): string {
  if (!path) return "";
  const m = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function isImagePath(path: string | null | undefined): boolean {
  return IMAGE_EXT.has(ext(path));
}

/** Map an `uploads/<name>` disk path (or an existing URL) to a browser URL. */
export function servedUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("uploads/")) {
    return "/api/files/" + path.slice("uploads/".length);
  }
  if (path.startsWith("/api/files/") || path.startsWith("http")) return path;
  return null;
}

/** Short uppercase type label (e.g. "FBX", "MP3"). */
export function fileTypeLabel(path: string | null | undefined): string {
  const e = ext(path);
  return e ? e.toUpperCase() : "FILE";
}

/** Emoji icon for a non-image file type. */
export function fileIcon(path: string | null | undefined): string {
  const e = ext(path);
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(e)) return "🎵";
  if (["glb", "gltf", "fbx", "obj", "usdz", "blend"].includes(e)) return "🧊";
  if (["mp4", "mov", "webm", "avi"].includes(e)) return "🎬";
  if (e === "pdf") return "📄";
  if (["zip", "rar", "7z"].includes(e)) return "🗜️";
  return "📦";
}
