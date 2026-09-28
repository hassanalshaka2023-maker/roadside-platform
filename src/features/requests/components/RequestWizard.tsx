"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, HelpCircle, MapPinOff } from "lucide-react";

import { serviceIcon } from "@/features/services/icons";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { FileUploadField, type UploadedFileInfo } from "@/components/ui/FileUploadField";
import { fieldAria, FormField } from "@/components/ui/FormField";
import { IdPrivacyNotice } from "@/components/ui/IdPrivacyNotice";
import { Input } from "@/components/ui/Input";
import { MapPicker } from "@/components/ui/MapPicker";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { CodeSignInForm } from "@/features/auth/components/CodeSignInForm";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { GOVERNORATES, governorateBySlug, nearestGovernorate } from "@/lib/geo";
import {
  requestFlowOtpAction,
  submitRequestAction,
  verifyRequestPhoneAction,
  type RequestFlowState,
} from "../actions";
import { carStepSchema, destinationSchema, locationStepSchema, VEHICLE_CATEGORIES } from "../schemas";

export interface WizardService {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  pricingNote: string | null;
  requiresDestination: boolean;
}

export interface WizardMapConfig {
  tileUrl: string;
  tileAttribution: string;
  defaultLat: number;
  defaultLng: number;
  defaultZoom: number;
}

type Step = "service" | "location" | "details" | "phone" | "review";

interface Draft {
  step: Step;
  clientRequestId: string;
  serviceTypeId: string;
  lat: number | null;
  lng: number | null;
  locationApproximate: boolean;
  governorate: string;
  governorateTouched: boolean;
  addressText: string;
  landmarkText: string;
  carMake: string;
  carModel: string;
  carYear: string;
  plateNumber: string;
  carCategory: string;
  problemDescription: string;
  problemUnknown: boolean;
  destinationText: string;
  vehicleCanRoll: "" | "yes" | "no";
  photos: UploadedFileInfo[];
  idFront: UploadedFileInfo | null;
}

/** Stored on the phone so a dropped connection or a reload loses nothing. */
const DRAFT_KEY = "najdat.request-draft.v1";
const MAX_PHOTOS = 3;
const MECHANIC_SLUG = "on-site-mechanic";
const EMPTY_STATE: RequestFlowState = { ok: false };

function newDraft(serviceTypeId = ""): Draft {
  return {
    step: serviceTypeId ? "location" : "service",
    clientRequestId: crypto.randomUUID(),
    serviceTypeId,
    lat: null,
    lng: null,
    locationApproximate: false,
    governorate: "",
    governorateTouched: false,
    addressText: "",
    landmarkText: "",
    carMake: "",
    carModel: "",
    carYear: "",
    plateNumber: "",
    carCategory: "",
    problemDescription: "",
    problemUnknown: false,
    destinationText: "",
    vehicleCanRoll: "",
    photos: [],
    idFront: null,
  };
}

function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? ({ ...newDraft(), ...JSON.parse(raw) } as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private mode or full storage: the form still works, it just won't
    // survive a reload.
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function RequestWizard({
  services,
  signedIn: initiallySignedIn,
  map,
  idRequired: initialIdRequired,
  channels,
  needsContactPhone = false,
  preselectedServiceId,
}: {
  services: WizardService[];
  signedIn: boolean;
  map: WizardMapConfig;
  /** Known on the server for a signed-in customer; for a guest it arrives
   *  with the phone verification. */
  idRequired: boolean;
  /** Which sign-in channels are open (phone needs an SMS gateway). */
  channels: { phone: boolean; email: boolean };
  /** Signed in by email without any phone number on file. */
  needsContactPhone?: boolean;
  preselectedServiceId?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>(() => newDraft(preselectedServiceId));
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(initiallySignedIn);
  const [idRequired, setIdRequired] = useState(initialIdRequired);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idConsent, setIdConsent] = useState(false);
  const [contactPhone, setContactPhone] = useState("");

  // Restore a saved draft once, on the client. Deliberately after mount: the
  // server cannot see localStorage, and rendering differently on the first
  // pass would be a hydration mismatch.
  useEffect(() => {
    const saved = loadDraft();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
    if (saved && (!preselectedServiceId || saved.serviceTypeId === preselectedServiceId)) setDraft(saved);
    setHydrated(true);
  }, [preselectedServiceId]);

  useEffect(() => {
    if (hydrated) saveDraft(draft);
  }, [draft, hydrated]);

  const service = services.find((s) => s.id === draft.serviceTypeId) ?? null;
  const needsDestination = service?.requiresDestination ?? false;

  const steps: Step[] = useMemo(
    () => (signedIn ? ["service", "location", "details", "review"] : ["service", "location", "details", "phone", "review"]),
    [signedIn],
  );
  const stepIndex = Math.max(0, steps.indexOf(draft.step));

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function goTo(step: Step) {
    setErrors({});
    update({ step });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function msg(code: string) {
    return t(`validation.${/^[A-Z_]+$/.test(code) ? code : "INVALID_INPUT"}`);
  }

  // --- per-step validation (the server validates everything again) --------

  function validateLocation(): boolean {
    const next: Record<string, string> = {};
    if (draft.lat === null || draft.lng === null) next.map = msg("LOCATION_REQUIRED");
    if (!draft.governorate) next.governorate = msg("GOVERNORATE_REQUIRED");
    if (draft.lat !== null && draft.lng !== null) {
      const parsed = locationStepSchema.safeParse({
        lat: draft.lat,
        lng: draft.lng,
        governorate: draft.governorate || undefined,
        addressText: draft.addressText,
        landmarkText: draft.landmarkText,
      });
      if (!parsed.success) next.map = msg(parsed.error.issues[0]?.message ?? "");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateDetails(): boolean {
    const next: Record<string, string> = {};
    const car = carStepSchema.safeParse({
      carMake: draft.carMake,
      carModel: draft.carModel,
      carYear: draft.carYear === "" ? undefined : draft.carYear,
      plateNumber: draft.plateNumber,
      problemDescription: draft.problemDescription,
      carCategory: draft.carCategory || undefined,
    });
    if (!car.success) next[String(car.error.issues[0]?.path[0] ?? "carYear")] = msg(car.error.issues[0]?.message ?? "");
    if (needsDestination) {
      const destination = destinationSchema.safeParse({ destinationText: draft.destinationText });
      if (!destination.success) next.destinationText = msg("DESTINATION_REQUIRED");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // --- location helpers -----------------------------------------------------

  function setPoint(point: { lat: number; lng: number }) {
    update({
      lat: point.lat,
      lng: point.lng,
      locationApproximate: false,
      // Suggest the governorate from the pin until the customer picks one.
      ...(draft.governorateTouched ? {} : { governorate: nearestGovernorate(point).slug }),
    });
  }

  function setApproximate(on: boolean) {
    if (!on) {
      update({ locationApproximate: false });
      return;
    }
    const g = governorateBySlug(draft.governorate) ?? governorateBySlug("damascus")!;
    update({ locationApproximate: true, lat: g.lat, lng: g.lng, governorate: g.slug });
  }

  // --- submit ---------------------------------------------------------------

  const [submitState, setSubmitState] = useState<RequestFlowState>(EMPTY_STATE);
  const [submitting, startSubmit] = useTransition();

  function submit() {
    if (idRequired && (!draft.idFront || !idConsent)) {
      setErrors({ idFront: msg(draft.idFront ? "CONSENT_REQUIRED" : "ID_REQUIRED") });
      return;
    }
    const payload = {
      clientRequestId: draft.clientRequestId,
      serviceTypeId: draft.serviceTypeId,
      lat: draft.lat,
      lng: draft.lng,
      locationApproximate: draft.locationApproximate,
      governorate: draft.governorate,
      addressText: draft.addressText,
      landmarkText: draft.landmarkText,
      carMake: draft.carMake,
      carModel: draft.carModel,
      carYear: draft.carYear === "" ? undefined : Number(draft.carYear),
      plateNumber: draft.plateNumber,
      carCategory: draft.carCategory || undefined,
      problemDescription: draft.problemDescription,
      problemUnknown: draft.problemUnknown,
      destinationText: needsDestination ? draft.destinationText : "",
      vehicleCanRoll: needsDestination && draft.vehicleCanRoll ? draft.vehicleCanRoll === "yes" : undefined,
      photoIds: draft.photos.map((p) => p.id),
      idFrontFileId: draft.idFront && idConsent ? draft.idFront.id : undefined,
      idConsentAccepted: idConsent,
    };
    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    if (needsContactPhone) formData.set("contactPhone", contactPhone);

    startSubmit(async () => {
      const result = await submitRequestAction(EMPTY_STATE, formData);
      setSubmitState(result);
      if (result.ok && result.data?.trackingToken) {
        clearDraft();
        router.push(`/track/${result.data.trackingToken}`);
      }
    });
  }

  if (!hydrated) {
    return <p className="py-10 text-center text-gray-600">{t("common.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Progress */}
      <ol className="flex items-center gap-1" aria-label={t("wizard.progressLabel")}>
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === stepIndex ? "step" : undefined}
            className={cn(
              "h-2 flex-1 rounded-full",
              index < stepIndex ? "bg-ink" : index === stepIndex ? "bg-brand-yellow" : "bg-gray-200",
            )}
          >
            <span className="sr-only">{t(`wizard.steps.${step}`)}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm font-bold text-gray-600">
        {t("wizard.stepOf", { current: stepIndex + 1, total: steps.length })} — {t(`wizard.steps.${draft.step}`)}
      </p>

      {/* 1. Service ----------------------------------------------------------- */}
      {draft.step === "service" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl">{t("wizard.serviceTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("wizard.serviceTitle")}>
            {services.map((s) => {
              const Icon = serviceIcon(s.slug);
              const selected = draft.serviceTypeId === s.id && !(draft.problemUnknown && s.slug === MECHANIC_SLUG);
              return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  update({ serviceTypeId: s.id, problemUnknown: false });
                  goTo("location");
                }}
                className={cn(
                  "flex min-h-[64px] items-center gap-3 rounded-xl border-2 p-3 text-start transition-colors sm:p-4",
                  selected ? "border-ink bg-brand-yellow-soft" : "border-gray-200 bg-white hover:border-ink",
                )}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink text-brand-yellow">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-extrabold">{s.name}</span>
                  {s.description ? <span className="mt-0.5 block text-sm leading-snug text-gray-600">{s.description}</span> : null}
                </span>
              </button>
              );
            })}
            {services.some((s) => s.slug === MECHANIC_SLUG) ? (
              <button
                type="button"
                role="radio"
                aria-checked={draft.problemUnknown}
                onClick={() => {
                  const mechanic = services.find((s) => s.slug === MECHANIC_SLUG)!;
                  update({ serviceTypeId: mechanic.id, problemUnknown: true });
                  goTo("location");
                }}
                className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white p-3 text-start hover:border-ink sm:p-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-red-soft text-brand-red">
                  <HelpCircle aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-extrabold">{t("wizard.dontKnow")}</span>
                  <span className="mt-1 block text-sm text-gray-600">{t("wizard.dontKnowHint")}</span>
                </span>
              </button>
            ) : null}
          </div>
          {services.length === 0 ? <p className="text-gray-600">{t("wizard.noServices")}</p> : null}
        </section>
      ) : null}

      {/* 2. Location ---------------------------------------------------------- */}
      {draft.step === "location" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl">{t("wizard.locationTitle")}</h2>
          <p className="text-sm text-gray-600">{t("wizard.locationHint")}</p>

          {!draft.locationApproximate ? (
            <MapPicker
              lat={draft.lat}
              lng={draft.lng}
              onChange={setPoint}
              tileUrl={map.tileUrl}
              tileAttribution={map.tileAttribution}
              defaultLat={map.defaultLat}
              defaultLng={map.defaultLng}
              defaultZoom={map.defaultZoom}
            />
          ) : null}
          {errors.map ? (
            <p role="alert" className="text-sm font-semibold text-brand-red">
              {errors.map}
            </p>
          ) : null}

          <label className="flex min-h-touch items-start gap-3 rounded-lg bg-gray-50 p-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-ink"
              checked={draft.locationApproximate}
              onChange={(e) => setApproximate(e.target.checked)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-bold">
                <MapPinOff aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t("wizard.cannotUseMap")}
              </span>
              <span className="block text-sm text-gray-600">{t("wizard.cannotUseMapHint")}</span>
            </span>
          </label>

          <FormField htmlFor="governorate" label={t("wizard.governorate")} error={errors.governorate} required>
            <Select
              id="governorate"
              value={draft.governorate}
              hasError={Boolean(errors.governorate)}
              onChange={(e) => {
                const g = governorateBySlug(e.target.value);
                update({
                  governorate: e.target.value,
                  governorateTouched: true,
                  ...(draft.locationApproximate && g ? { lat: g.lat, lng: g.lng } : {}),
                });
              }}
              {...fieldAria("governorate", { error: errors.governorate })}
            >
              <option value="">{t("wizard.chooseGovernorate")}</option>
              {GOVERNORATES.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {locale === "ar" ? g.nameAr : g.nameEn}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            htmlFor="landmarkText"
            label={t("wizard.landmark")}
            hint={t("wizard.landmarkHint")}
            error={errors.landmarkText}
            optionalLabel={t("common.optional")}
          >
            <Input
              id="landmarkText"
              value={draft.landmarkText}
              maxLength={300}
              onChange={(e) => update({ landmarkText: e.target.value })}
              hasError={Boolean(errors.landmarkText)}
              {...fieldAria("landmarkText", { hint: t("wizard.landmarkHint"), error: errors.landmarkText })}
            />
          </FormField>

          <FormField htmlFor="addressText" label={t("wizard.address")} optionalLabel={t("common.optional")}>
            <Input id="addressText" value={draft.addressText} maxLength={300} onChange={(e) => update({ addressText: e.target.value })} />
          </FormField>

          <StepNav
            onBack={() => goTo("service")}
            onNext={() => validateLocation() && goTo("details")}
          />
        </section>
      ) : null}

      {/* 3. Car and problem --------------------------------------------------- */}
      {draft.step === "details" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl">{t("wizard.detailsTitle")}</h2>

          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
            <FormField htmlFor="carMake" label={t("wizard.carMake")} optionalLabel={t("common.optional")}>
              <Input id="carMake" value={draft.carMake} maxLength={60} placeholder={t("wizard.carMakePlaceholder")} onChange={(e) => update({ carMake: e.target.value })} />
            </FormField>
            <FormField htmlFor="carModel" label={t("wizard.carModel")} optionalLabel={t("common.optional")}>
              <Input id="carModel" value={draft.carModel} maxLength={60} onChange={(e) => update({ carModel: e.target.value })} />
            </FormField>
            <FormField htmlFor="carYear" label={t("wizard.carYear")} error={errors.carYear} optionalLabel={t("common.optional")}>
              <Input
                id="carYear"
                inputMode="numeric"
                dir="ltr"
                value={draft.carYear}
                maxLength={4}
                onChange={(e) => update({ carYear: e.target.value.replace(/\D/g, "") })}
                hasError={Boolean(errors.carYear)}
                {...fieldAria("carYear", { error: errors.carYear })}
              />
            </FormField>
            <FormField htmlFor="carCategory" label={t("wizard.carCategory")} optionalLabel={needsDestination ? undefined : t("common.optional")}>
              <Select id="carCategory" value={draft.carCategory} onChange={(e) => update({ carCategory: e.target.value })}>
                <option value="">{t("wizard.chooseCategory")}</option>
                {VEHICLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`vehicleCategory.${c}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {needsDestination ? (
            <>
              <FormField
                htmlFor="destinationText"
                label={t("wizard.destination")}
                hint={t("wizard.destinationHint")}
                error={errors.destinationText}
                required
              >
                <Input
                  id="destinationText"
                  value={draft.destinationText}
                  maxLength={300}
                  onChange={(e) => update({ destinationText: e.target.value })}
                  hasError={Boolean(errors.destinationText)}
                  {...fieldAria("destinationText", { hint: t("wizard.destinationHint"), error: errors.destinationText })}
                />
              </FormField>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-bold">{t("wizard.canRoll")}</legend>
                {(["yes", "no"] as const).map((value) => (
                  <label key={value} className="flex min-h-touch items-center gap-3">
                    <input
                      type="radio"
                      name="vehicleCanRoll"
                      className="h-5 w-5 accent-ink"
                      checked={draft.vehicleCanRoll === value}
                      onChange={() => update({ vehicleCanRoll: value })}
                    />
                    {t(`wizard.canRoll_${value}`)}
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}

          <label className="flex min-h-touch items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5 accent-ink"
              checked={draft.problemUnknown}
              onChange={(e) => update({ problemUnknown: e.target.checked })}
            />
            <span className="font-bold">{t("wizard.dontKnow")}</span>
          </label>

          <FormField
            htmlFor="problemDescription"
            label={t("wizard.problem")}
            hint={t("wizard.problemHint")}
            error={errors.problemDescription}
            optionalLabel={t("common.optional")}
          >
            <Textarea
              id="problemDescription"
              rows={3}
              maxLength={1000}
              value={draft.problemDescription}
              onChange={(e) => update({ problemDescription: e.target.value })}
              hasError={Boolean(errors.problemDescription)}
              {...fieldAria("problemDescription", { hint: t("wizard.problemHint"), error: errors.problemDescription })}
            />
          </FormField>

          <FormField htmlFor="plateNumber" label={t("wizard.plate")} hint={t("wizard.plateHint")} optionalLabel={t("common.optional")}>
            <Input id="plateNumber" value={draft.plateNumber} maxLength={30} onChange={(e) => update({ plateNumber: e.target.value })} />
          </FormField>

          <StepNav
            onBack={() => goTo("location")}
            onNext={() => validateDetails() && goTo(signedIn ? "review" : "phone")}
          />
        </section>
      ) : null}

      {/* 4. Phone ------------------------------------------------------------- */}
      {draft.step === "phone" && !signedIn ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl">{t("wizard.phoneTitle")}</h2>
          <p className="text-sm text-gray-600">{t(channels.email ? "wizard.contactHintBoth" : "wizard.phoneHint")}</p>
          <CodeSignInForm
            channels={channels}
            sendAction={requestFlowOtpAction}
            verifyAction={verifyRequestPhoneAction}
            askContactPhone
            onVerified={(state) => {
              setSignedIn(true);
              setIdRequired(Boolean(state.idRequired));
              goTo("review");
            }}
          />
          <Button variant="ghost" onClick={() => goTo("details")}>
            {t("common.back")}
          </Button>
        </section>
      ) : null}

      {/* 5. Review and send --------------------------------------------------- */}
      {draft.step === "review" || (draft.step === "phone" && signedIn) ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl">{t("wizard.reviewTitle")}</h2>

          <dl className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <SummaryRow label={t("wizard.steps.service")}>
              {service?.name}
              {draft.problemUnknown ? ` — ${t("wizard.dontKnow")}` : ""}
            </SummaryRow>
            <SummaryRow label={t("wizard.governorate")}>
              {locale === "ar" ? governorateBySlug(draft.governorate)?.nameAr : governorateBySlug(draft.governorate)?.nameEn}
              {draft.locationApproximate ? ` — ${t("wizard.approximate")}` : ""}
            </SummaryRow>
            {draft.landmarkText ? <SummaryRow label={t("wizard.landmark")}>{draft.landmarkText}</SummaryRow> : null}
            {needsDestination ? <SummaryRow label={t("wizard.destination")}>{draft.destinationText}</SummaryRow> : null}
            {draft.carMake || draft.carModel ? (
              <SummaryRow label={t("wizard.car")}>
                {[draft.carMake, draft.carModel, draft.carYear].filter(Boolean).join(" ")}
              </SummaryRow>
            ) : null}
          </dl>

          {service?.pricingNote ? (
            <p className="rounded-lg bg-brand-yellow-soft p-3 text-sm">
              <span className="font-extrabold">{t("wizard.howPricing")}: </span>
              {service.pricingNote}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            <p className="font-bold">
              {t("wizard.photos")} <span className="font-normal text-gray-500">({t("common.optional")})</span>
            </p>
            <p className="text-sm text-gray-600">{t("wizard.photosHint")}</p>
            {draft.photos.map((photo, index) => (
              <FileUploadField
                key={photo.id}
                id={`photo-${index}`}
                kind="REQUEST_PHOTO"
                label={t("wizard.photoN", { n: index + 1 })}
                value={photo}
                onChange={(file) =>
                  update({ photos: file ? draft.photos.map((p, i) => (i === index ? file : p)) : draft.photos.filter((_, i) => i !== index) })
                }
              />
            ))}
            {draft.photos.length < MAX_PHOTOS ? (
              <FileUploadField
                key={`new-${draft.photos.length}`}
                id="photo-new"
                kind="REQUEST_PHOTO"
                label={t("wizard.photoN", { n: draft.photos.length + 1 })}
                value={null}
                onChange={(file) => file && update({ photos: [...draft.photos, file] })}
              />
            ) : null}
          </div>

          {idRequired ? (
            <div className="flex flex-col gap-3 rounded-xl border-2 border-gray-200 p-4">
              <FileUploadField
                kind="ID_FRONT"
                label={t("wizard.idFront")}
                hint={t("wizard.idWhy")}
                value={draft.idFront}
                onChange={(file) => update({ idFront: file })}
                required
              />
              <IdPrivacyNotice accepted={idConsent} onAcceptedChange={setIdConsent} showRequiredError={Boolean(errors.idFront)} />
              {errors.idFront ? (
                <p role="alert" className="text-sm font-semibold text-brand-red">
                  {errors.idFront}
                </p>
              ) : null}
            </div>
          ) : null}

          {needsContactPhone ? (
            <FormField htmlFor="contactPhone" label={t("auth.contactPhoneLabel")} hint={t("auth.contactPhoneHint")} required>
              <Input id="contactPhone" type="tel" dir="ltr" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder={t("auth.phonePlaceholder")} />
            </FormField>
          ) : null}

          {submitState.errorKey ? (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm font-semibold text-danger">
              {t(submitState.errorKey, submitState.errorValues)}
            </p>
          ) : null}

          <Button size="lg" fullWidth onClick={submit} isLoading={submitting} loadingLabel={t("common.sending")}>
            {t("wizard.send")}
          </Button>
          <p className="text-center text-xs text-gray-500">{t("wizard.sendNote")}</p>
          <Button variant="ghost" onClick={() => goTo("details")} disabled={submitting}>
            {t("common.back")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-2 last:border-b-0">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-end font-bold">{children}</dd>
    </div>
  );
}

function StepNav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const Next = locale === "ar" ? ArrowLeft : ArrowRight;
  return (
    <div className="flex gap-3 pt-2">
      <Button variant="outline" onClick={onBack} className="flex-1">
        <Back aria-hidden="true" className="h-5 w-5" />
        {t("back")}
      </Button>
      <Button onClick={onNext} className="flex-[2]" size="lg">
        {t("next")}
        <Next aria-hidden="true" className="h-5 w-5" />
      </Button>
    </div>
  );
}
