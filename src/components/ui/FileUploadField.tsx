"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, ImageUp, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import { Button } from "./Button";

export type UploadKind =
  | "ID_FRONT"
  | "ID_BACK"
  | "SELFIE"
  | "REQUEST_PHOTO"
  | "EQUIPMENT_PHOTO";

export interface UploadedFileInfo {
  id: string;
  kind: UploadKind;
  mimeType: string;
  sizeBytes: number;
}

export interface FileUploadFieldProps {
  kind: UploadKind;
  label: string;
  hint?: string;
  value: UploadedFileInfo | null;
  onChange: (file: UploadedFileInfo | null) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

/** Longest side after client-side compression. */
const CLIENT_MAX_DIMENSION = 1600;
const CLIENT_JPEG_QUALITY = 0.85;

/** ID documents are never shown back to the user once uploaded. */
const ID_KINDS: UploadKind[] = ["ID_FRONT", "ID_BACK", "SELFIE"];

type Phase = "idle" | "compressing" | "uploading" | "done" | "error";

/**
 * Upload control for a single image.
 *
 * Compresses in the browser before sending. That is not a nicety here: a
 * modern phone camera produces 4-8 MB per photo, and on a 2G connection that
 * is the difference between an upload that finishes and one that times out.
 * It also converts HEIC to JPEG on iPhones - Safari can decode HEIC natively,
 * while our server-side sharp build cannot - so the format never reaches us.
 */
export function FileUploadField({
  kind,
  label,
  hint,
  value,
  onChange,
  disabled,
  required,
  id,
}: FileUploadFieldProps) {
  const t = useTranslations("files");

  const [phase, setPhase] = useState<Phase>(value ? "done" : "idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const lastFile = useRef<File | null>(null);

  const isIdDocument = ID_KINDS.includes(kind);
  const fieldId = id ?? `upload-${kind.toLowerCase()}`;

  // Object URLs leak until revoked, and a user retaking a photo five times
  // would otherwise pin five full-size bitmaps in memory.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      xhrRef.current?.abort();
    };
  }, [previewUrl]);

  /** Draws the image onto a canvas at a bounded size and re-encodes as JPEG. */
  const compress = useCallback(async (file: File): Promise<Blob> => {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // Browser could not decode it at all (a HEIC outside Safari, or junk).
      throw new Error("UNSUPPORTED_TYPE");
    }

    const scale = Math.min(
      1,
      CLIENT_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("CORRUPT");

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // Drawing through a canvas discards EXIF as a side effect, so GPS
    // coordinates never leave the device. The server re-encodes again anyway.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", CLIENT_JPEG_QUALITY),
    );

    if (!blob) throw new Error("CORRUPT");
    return blob;
  }, []);

  /** XHR rather than fetch: only XHR reports upload progress. */
  const send = useCallback(
    (blob: Blob): Promise<UploadedFileInfo> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.open("POST", `/api/files?kind=${encodeURIComponent(kind)}`, true);
        xhr.responseType = "json";
        // Opaque on purpose: the server determines the real type itself.
        xhr.setRequestHeader("Content-Type", "application/octet-stream");

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          const body = xhr.response as
            | { ok: true; file: UploadedFileInfo }
            | { ok: false; errorKey: string }
            | null;

          if (xhr.status >= 200 && xhr.status < 300 && body && body.ok) {
            resolve(body.file);
          } else {
            reject(new Error(body && !body.ok ? body.errorKey : "files.errors.NETWORK"));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("files.errors.NETWORK")));
        xhr.addEventListener("abort", () => reject(new Error("files.errors.NETWORK")));

        xhr.send(blob);
      });
    },
    [kind],
  );

  const handleFile = useCallback(
    async (file: File) => {
      lastFile.current = file;
      setErrorKey(null);
      setProgress(0);
      setPhase("compressing");

      try {
        const blob = await compress(file);

        if (!isIdDocument) {
          // Preview only for non-sensitive kinds. An ID scan is never
          // rendered back, not even locally.
          setPreviewUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return URL.createObjectURL(blob);
          });
        }

        setPhase("uploading");
        const uploaded = await send(blob);

        setPhase("done");
        onChange(uploaded);
      } catch (error) {
        const raw = error instanceof Error ? error.message : "files.errors.NETWORK";
        // Errors from compress() are bare codes; from send() they are full keys.
        setErrorKey(raw.includes(".") ? raw : `files.errors.${raw}`);
        setPhase("error");
      }
    },
    [compress, isIdDocument, onChange, send],
  );

  function onPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (file) void handleFile(file);
  }

  function reset() {
    xhrRef.current?.abort();
    setPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    setPhase("idle");
    setErrorKey(null);
    setProgress(0);
    lastFile.current = null;
    onChange(null);
  }

  const busy = phase === "compressing" || phase === "uploading";

  return (
    <div className="flex flex-col gap-2">
      <span id={`${fieldId}-label`} className="text-sm font-bold text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-brand-red">
            *
          </span>
        ) : null}
      </span>

      {/* Hidden inputs. `capture` asks the OS for the camera directly;
          "user" is the front camera, which is what a selfie needs. */}
      <input
        ref={fileInput}
        id={fieldId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
        className="sr-only"
        onChange={onPicked}
        disabled={disabled || busy}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture={kind === "SELFIE" ? "user" : "environment"}
        className="sr-only"
        onChange={onPicked}
        disabled={disabled || busy}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-4",
          phase === "error" ? "border-brand-red bg-danger-soft" : "border-gray-300",
          phase === "done" && "border-success bg-success-soft",
        )}
      >
        {phase === "done" ? (
          <div className="flex items-center gap-3">
            {previewUrl && !isIdDocument ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local
              // object URL, never a remote or optimisable source.
              <img
                src={previewUrl}
                alt={t("preview")}
                className="h-20 w-20 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success text-white">
                <Check aria-hidden="true" className="h-6 w-6" />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="font-bold text-success">{t("uploaded")}</p>
              {isIdDocument ? (
                <p className="mt-1 text-sm text-gray-600">{t("uploadedNoPreview")}</p>
              ) : null}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={disabled}
            >
              <X aria-hidden="true" className="h-4 w-4" />
              {t("remove")}
            </Button>
          </div>
        ) : busy ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold">
              {phase === "compressing" ? t("compressing") : t("uploading")}
            </p>
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("progress", { percent: progress })}
              className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
            >
              <div
                className="h-full bg-brand-yellow transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={disabled}
            >
              <ImageUp aria-hidden="true" className="h-5 w-5" />
              {t("chooseFile")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => cameraInput.current?.click()}
              disabled={disabled}
            >
              <Camera aria-hidden="true" className="h-5 w-5" />
              {t("takePhoto")}
            </Button>

            {phase === "error" && lastFile.current ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => lastFile.current && void handleFile(lastFile.current)}
                disabled={disabled}
              >
                <RotateCcw aria-hidden="true" className="h-5 w-5" />
                {t("retry")}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {errorKey ? (
        <p role="alert" className="text-sm font-semibold text-brand-red">
          <ErrorMessage messageKey={errorKey} />
        </p>
      ) : (
        <p className="text-sm text-gray-600">{hint ?? t("hint")}</p>
      )}
    </div>
  );
}

/**
 * Resolves a namespace-qualified key coming from the server, e.g.
 * "files.errors.TOO_LARGE".
 *
 * `t.has` is checked first so an unexpected key from the server degrades to a
 * generic message instead of rendering a raw key at the user.
 */
function ErrorMessage({ messageKey }: { messageKey: string }) {
  const t = useTranslations();
  return <>{t.has(messageKey) ? t(messageKey) : t("files.errors.NETWORK")}</>;
}
