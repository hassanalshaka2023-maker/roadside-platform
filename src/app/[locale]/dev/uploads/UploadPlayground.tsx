"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  FileUploadField,
  type UploadedFileInfo,
  type UploadKind,
} from "@/components/ui/FileUploadField";
import { IdPrivacyNotice } from "@/components/ui/IdPrivacyNotice";

const KINDS: UploadKind[] = [
  "ID_FRONT",
  "ID_BACK",
  "SELFIE",
  "REQUEST_PHOTO",
  "EQUIPMENT_PHOTO",
];

/** Exercises every upload kind and links to the read endpoint. */
export function UploadPlayground() {
  const t = useTranslations("dev");
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<Record<string, UploadedFileInfo | null>>({});

  const uploaded = Object.values(files).filter(
    (file): file is UploadedFileInfo => file !== null,
  );

  return (
    <div className="flex flex-col gap-6">
      <IdPrivacyNotice accepted={consent} onAcceptedChange={setConsent} />

      {KINDS.map((kind) => (
        <FileUploadField
          key={kind}
          kind={kind}
          label={kind}
          value={files[kind] ?? null}
          onChange={(file) => setFiles((current) => ({ ...current, [kind]: file }))}
        />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>{t("uploadedFiles")}</CardTitle>
        </CardHeader>
        <CardBody>
          {uploaded.length === 0 ? (
            <p className="text-gray-600">—</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {uploaded.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{file.kind}</span>
                  <span className="font-mono text-xs text-gray-600">{file.id}</span>
                  <span className="text-gray-500">{file.sizeBytes} B</span>
                  <a
                    href={`/api/files/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-brand-red underline"
                  >
                    {t("openInApi")}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
