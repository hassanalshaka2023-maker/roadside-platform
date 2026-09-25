"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { FileUploadField, type UploadedFileInfo, type UploadKind } from "@/components/ui/FileUploadField";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { MapPicker } from "@/components/ui/MapPicker";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { GOVERNORATES } from "@/lib/geo";
import { VEHICLE_CATEGORIES } from "@/features/requests/schemas";
import type { WizardMapConfig } from "@/features/requests/components/RequestWizard";
import { saveApplicationAction } from "../actions";
import {
  missingForSubmission,
  PROVIDER_SPECIALTIES,
  TOWING_SLUG,
  type ApplicationInput,
  type MissingField,
} from "../schemas";

export interface ApplicationServiceOption {
  slug: string;
  name: string;
}

type FileRef = UploadedFileInfo | null;

/** A file already on the application: we know its id and kind, nothing more. */
function existing(id: string | null | undefined, kind: UploadKind): FileRef {
  return id ? { id, kind, mimeType: "image/jpeg", sizeBytes: 0 } : null;
}

export function ApplicationForm({
  initial,
  services,
  map,
}: {
  initial: Partial<ApplicationInput> & { fullName?: string };
  services: ApplicationServiceOption[];
  map: WizardMapConfig;
}) {
  const t = useTranslations();
  const locale = useLocale();

  const [form, setForm] = useState({
    fullName: initial.fullName ?? "",
    providerKind: initial.providerKind ?? "INDEPENDENT",
    workshopName: initial.workshopName ?? "",
    workshopAddress: initial.workshopAddress ?? "",
    specialties: initial.specialties ?? [],
    serviceTypes: initial.serviceTypes ?? [],
    yearsOfExperience: initial.yearsOfExperience?.toString() ?? "",
    equipmentDescription: initial.equipmentDescription ?? "",
    governorate: initial.governorate ?? "",
    coverageAreas: (initial.coverageAreas ?? []).join("، "),
    baseLat: initial.baseLat ?? null,
    baseLng: initial.baseLng ?? null,
    availability: initial.availability ?? "H24",
    availabilityNotes: initial.availabilityNotes ?? "",
    towVehicleType: initial.towVehicleType ?? "",
    towVehiclePlate: initial.towVehiclePlate ?? "",
    towCapacities: initial.towCapacities ?? [],
    consentTerms: initial.consentTerms ?? false,
    consentAccuracy: initial.consentAccuracy ?? false,
    consentNoHiddenFees: initial.consentNoHiddenFees ?? false,
  });
  const [idFront, setIdFront] = useState<FileRef>(existing(initial.idDocumentFrontId, "ID_FRONT"));
  const [idBack, setIdBack] = useState<FileRef>(existing(initial.idDocumentBackId, "ID_BACK"));
  const [selfie, setSelfie] = useState<FileRef>(existing(initial.selfieId, "SELFIE"));
  const [vehicleDoc, setVehicleDoc] = useState<FileRef>(existing(initial.vehicleDocumentId, "VEHICLE_DOCUMENT"));
  const [vehiclePhotos, setVehiclePhotos] = useState<UploadedFileInfo[]>(
    (initial.vehiclePhotoIds ?? []).map((id) => existing(id, "VEHICLE_PHOTO")!),
  );
  const [equipmentPhotos, setEquipmentPhotos] = useState<UploadedFileInfo[]>(
    (initial.equipmentPhotoIds ?? []).map((id) => existing(id, "EQUIPMENT_PHOTO")!),
  );

  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; errorKey?: string; intent?: string } | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  const offersTowing = form.serviceTypes.includes(TOWING_SLUG);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(key: "specialties" | "serviceTypes" | "towCapacities", value: string) {
    setForm((current) => {
      const list = current[key] as string[];
      return { ...current, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
  }

  function buildInput(): ApplicationInput {
    return {
      fullName: form.fullName.trim(),
      providerKind: form.providerKind as ApplicationInput["providerKind"],
      workshopName: form.workshopName,
      workshopAddress: form.workshopAddress,
      specialties: form.specialties as ApplicationInput["specialties"],
      serviceTypes: form.serviceTypes,
      yearsOfExperience: form.yearsOfExperience === "" ? undefined : Number(form.yearsOfExperience),
      equipmentDescription: form.equipmentDescription,
      governorate: form.governorate,
      coverageAreas: form.coverageAreas
        .split(/[،,]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
        .slice(0, 10),
      baseLat: form.baseLat ?? undefined,
      baseLng: form.baseLng ?? undefined,
      availability: form.availability as ApplicationInput["availability"],
      availabilityNotes: form.availabilityNotes,
      towVehicleType: offersTowing ? form.towVehicleType : "",
      towVehiclePlate: offersTowing ? form.towVehiclePlate : "",
      towCapacities: offersTowing ? (form.towCapacities as ApplicationInput["towCapacities"]) : [],
      vehiclePhotoIds: offersTowing ? vehiclePhotos.map((f) => f.id) : [],
      vehicleDocumentId: offersTowing ? vehicleDoc?.id : undefined,
      idDocumentFrontId: idFront?.id,
      idDocumentBackId: idBack?.id,
      selfieId: selfie?.id,
      equipmentPhotoIds: equipmentPhotos.map((f) => f.id),
      consentTerms: form.consentTerms,
      consentAccuracy: form.consentAccuracy,
      consentNoHiddenFees: form.consentNoHiddenFees,
    };
  }

  const missing: MissingField[] = missingForSubmission(buildInput());

  function send(intent: "draft" | "submit") {
    if (intent === "submit" && missing.length > 0) {
      setShowMissing(true);
      setResult(null);
      return;
    }
    if (form.fullName.trim().length < 3 || !form.governorate) {
      setResult({ ok: false, errorKey: "validation.NAME_AND_GOVERNORATE_REQUIRED" });
      return;
    }
    const formData = new FormData();
    formData.set("payload", JSON.stringify(buildInput()));
    formData.set("intent", intent);
    startTransition(async () => {
      const response = await saveApplicationAction({ ok: false }, formData);
      setResult({ ok: response.ok, errorKey: response.errorKey, intent });
      if (response.ok) window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const photoList = (
    list: UploadedFileInfo[],
    setList: (next: UploadedFileInfo[]) => void,
    kind: UploadKind,
    label: string,
    max: number,
  ) => (
    <div className="flex flex-col gap-3">
      {list.map((file, index) => (
        <FileUploadField
          key={file.id}
          id={`${kind}-${index}`}
          kind={kind}
          label={`${label} ${index + 1}`}
          value={file}
          onChange={(next) => setList(next ? list.map((f, i) => (i === index ? next : f)) : list.filter((_, i) => i !== index))}
        />
      ))}
      {list.length < max ? (
        <FileUploadField
          key={`${kind}-new-${list.length}`}
          id={`${kind}-new`}
          kind={kind}
          label={`${label} ${list.length + 1}`}
          value={null}
          onChange={(next) => next && setList([...list, next])}
        />
      ) : null}
    </div>
  );

  const section = "flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5";
  const check = "flex min-h-touch items-center gap-3";

  return (
    <div className="flex flex-col gap-5">
      {result?.ok ? (
        <p role="status" className="rounded-lg bg-success-soft p-3 font-bold text-success">
          {t(result.intent === "submit" ? "apply.submitted" : "apply.saved")}
        </p>
      ) : null}

      {/* Identity ---------------------------------------------------------- */}
      <section className={section}>
        <h2 className="text-lg">{t("apply.sectionIdentity")}</h2>
        <FormField htmlFor="fullName" label={t("apply.fullName")} required>
          <Input id="fullName" value={form.fullName} maxLength={100} onChange={(e) => set("fullName", e.target.value)} />
        </FormField>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-bold">{t("apply.providerKind")}</legend>
          {(["INDEPENDENT", "WORKSHOP"] as const).map((kind) => (
            <label key={kind} className={check}>
              <input type="radio" name="providerKind" className="h-5 w-5 accent-ink" checked={form.providerKind === kind} onChange={() => set("providerKind", kind)} />
              {t(`apply.kind_${kind}`)}
            </label>
          ))}
        </fieldset>
        {form.providerKind === "WORKSHOP" ? (
          <>
            <FormField htmlFor="workshopName" label={t("apply.workshopName")} required>
              <Input id="workshopName" value={form.workshopName} maxLength={120} onChange={(e) => set("workshopName", e.target.value)} />
            </FormField>
            <FormField htmlFor="workshopAddress" label={t("apply.workshopAddress")} optionalLabel={t("common.optional")}>
              <Input id="workshopAddress" value={form.workshopAddress} maxLength={300} onChange={(e) => set("workshopAddress", e.target.value)} />
            </FormField>
          </>
        ) : null}
      </section>

      {/* Work ---------------------------------------------------------------- */}
      <section className={section}>
        <h2 className="text-lg">{t("apply.sectionWork")}</h2>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-bold">{t("apply.specialties")} *</legend>
          {PROVIDER_SPECIALTIES.map((s) => (
            <label key={s} className={check}>
              <input type="checkbox" className="h-5 w-5 accent-ink" checked={form.specialties.includes(s)} onChange={() => toggle("specialties", s)} />
              {t(`apply.specialty.${s}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-bold">{t("apply.services")} *</legend>
          {services.map((s) => (
            <label key={s.slug} className={check}>
              <input type="checkbox" className="h-5 w-5 accent-ink" checked={form.serviceTypes.includes(s.slug)} onChange={() => toggle("serviceTypes", s.slug)} />
              {s.name}
            </label>
          ))}
        </fieldset>
        <FormField htmlFor="years" label={t("apply.yearsOfExperience")} optionalLabel={t("common.optional")}>
          <Input id="years" inputMode="numeric" dir="ltr" maxLength={2} value={form.yearsOfExperience} onChange={(e) => set("yearsOfExperience", e.target.value.replace(/\D/g, ""))} />
        </FormField>
        <FormField htmlFor="equipment" label={t("apply.equipment")} hint={t("apply.equipmentHint")} optionalLabel={t("common.optional")}>
          <Textarea id="equipment" rows={3} maxLength={1000} value={form.equipmentDescription} onChange={(e) => set("equipmentDescription", e.target.value)} />
        </FormField>
        {photoList(equipmentPhotos, setEquipmentPhotos, "EQUIPMENT_PHOTO", t("apply.equipmentPhoto"), 4)}
      </section>

      {/* Area ----------------------------------------------------------------- */}
      <section className={section}>
        <h2 className="text-lg">{t("apply.sectionArea")}</h2>
        <FormField htmlFor="gov" label={t("apply.governorate")} required>
          <Select id="gov" value={form.governorate} onChange={(e) => set("governorate", e.target.value)}>
            <option value="">{t("wizard.chooseGovernorate")}</option>
            {GOVERNORATES.map((g) => (
              <option key={g.slug} value={g.slug}>
                {locale === "ar" ? g.nameAr : g.nameEn}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="areas" label={t("apply.coverageAreas")} hint={t("apply.coverageHint")} optionalLabel={t("common.optional")}>
          <Input id="areas" value={form.coverageAreas} maxLength={600} onChange={(e) => set("coverageAreas", e.target.value)} />
        </FormField>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold">{t("apply.baseLocation")} *</p>
          <p className="text-sm text-gray-600">{t("apply.baseLocationHint")}</p>
          <MapPicker
            lat={form.baseLat}
            lng={form.baseLng}
            onChange={(p) => setForm((c) => ({ ...c, baseLat: p.lat, baseLng: p.lng }))}
            tileUrl={map.tileUrl}
            tileAttribution={map.tileAttribution}
            defaultLat={map.defaultLat}
            defaultLng={map.defaultLng}
            defaultZoom={map.defaultZoom}
          />
        </div>
        <FormField htmlFor="availability" label={t("apply.availability")}>
          <Select id="availability" value={form.availability} onChange={(e) => set("availability", e.target.value as typeof form.availability)}>
            {(["H24", "DAYTIME", "CUSTOM"] as const).map((a) => (
              <option key={a} value={a}>
                {t(`apply.availability_${a}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="hours" label={t("apply.availabilityNotes")} optionalLabel={t("common.optional")}>
          <Input id="hours" value={form.availabilityNotes} maxLength={300} onChange={(e) => set("availabilityNotes", e.target.value)} />
        </FormField>
      </section>

      {/* Towing ------------------------------------------------------------- */}
      {offersTowing ? (
        <section className={section}>
          <h2 className="text-lg">{t("apply.sectionTowing")}</h2>
          <FormField htmlFor="towType" label={t("apply.towVehicleType")} required>
            <Input id="towType" value={form.towVehicleType} maxLength={100} onChange={(e) => set("towVehicleType", e.target.value)} />
          </FormField>
          <FormField htmlFor="towPlate" label={t("apply.towVehiclePlate")} required>
            <Input id="towPlate" value={form.towVehiclePlate} maxLength={30} onChange={(e) => set("towVehiclePlate", e.target.value)} />
          </FormField>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-bold">{t("apply.towCapacities")} *</legend>
            {VEHICLE_CATEGORIES.map((c) => (
              <label key={c} className={check}>
                <input type="checkbox" className="h-5 w-5 accent-ink" checked={form.towCapacities.includes(c)} onChange={() => toggle("towCapacities", c)} />
                {t(`vehicleCategory.${c}`)}
              </label>
            ))}
          </fieldset>
          {photoList(vehiclePhotos, setVehiclePhotos, "VEHICLE_PHOTO", t("apply.vehiclePhoto"), 4)}
          <FileUploadField kind="VEHICLE_DOCUMENT" label={t("apply.vehicleDocument")} hint={t("apply.vehicleDocumentHint")} value={vehicleDoc} onChange={setVehicleDoc} required />
        </section>
      ) : null}

      {/* Documents ------------------------------------------------------------ */}
      <section className={section}>
        <h2 className="text-lg">{t("apply.sectionDocuments")}</h2>
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{t("apply.documentsPrivacy")}</p>
        <FileUploadField kind="SELFIE" label={t("apply.selfie")} hint={t("apply.selfieHint")} value={selfie} onChange={setSelfie} required />
        <FileUploadField kind="ID_FRONT" label={t("apply.idFront")} value={idFront} onChange={setIdFront} required />
        <FileUploadField kind="ID_BACK" label={t("apply.idBack")} value={idBack} onChange={setIdBack} />
      </section>

      {/* Consents ------------------------------------------------------------- */}
      <section className={section}>
        <h2 className="text-lg">{t("apply.sectionConsent")}</h2>
        {(["consentTerms", "consentAccuracy", "consentNoHiddenFees"] as const).map((key) => (
          <label key={key} className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
            <span className="text-sm">{t(`apply.${key}`)}</span>
          </label>
        ))}
        <p className="text-xs text-gray-500">{t("apply.notVerification")}</p>
      </section>

      {showMissing && missing.length > 0 ? (
        <div role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger">
          <p className="font-bold">{t("apply.missingTitle")}</p>
          <ul className="mt-2 list-inside list-disc">
            {missing.map((m) => (
              <li key={m}>{t(`apply.missing.${m}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result && !result.ok && result.errorKey ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm font-semibold text-danger">
          {t(result.errorKey)}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" className="sm:flex-[2]" onClick={() => send("submit")} isLoading={pending} loadingLabel={t("common.sending")}>
          {t("apply.submit")}
        </Button>
        <Button variant="outline" size="lg" className="sm:flex-1" onClick={() => send("draft")} disabled={pending}>
          {t("apply.saveDraft")}
        </Button>
      </div>
    </div>
  );
}
