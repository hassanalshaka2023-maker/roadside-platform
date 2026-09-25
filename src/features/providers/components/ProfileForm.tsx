"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { MapPicker } from "@/components/ui/MapPicker";
import type { WizardMapConfig } from "@/features/requests/components/RequestWizard";
import { updateProfileAction } from "@/features/jobs/actions";

/** The few things a provider may change about themselves. */
export function ProfileForm({
  initial,
  map,
}: {
  initial: { serviceRadiusKm: number; workingHours: string; coverageAreas: string[]; lat: number | null; lng: number | null };
  map: WizardMapConfig;
}) {
  const t = useTranslations();
  const [point, setPoint] = useState<{ lat: number | null; lng: number | null }>({ lat: initial.lat, lng: initial.lng });

  return (
    <ActionForm action={updateProfileAction} successMessage="provider.profile.saved">
      <FormField htmlFor="serviceRadiusKm" label={t("provider.profile.radius")} hint={t("provider.profile.radiusHint")} required>
        <Input id="serviceRadiusKm" name="serviceRadiusKm" inputMode="numeric" dir="ltr" className="numeric" defaultValue={initial.serviceRadiusKm} maxLength={3} required />
      </FormField>
      <FormField htmlFor="workingHours" label={t("provider.profile.workingHours")} optionalLabel={t("common.optional")}>
        <Input id="workingHours" name="workingHours" defaultValue={initial.workingHours} maxLength={300} />
      </FormField>
      <FormField htmlFor="coverageAreas" label={t("apply.coverageAreas")} hint={t("apply.coverageHint")} optionalLabel={t("common.optional")}>
        <Input id="coverageAreas" name="coverageAreas" defaultValue={initial.coverageAreas.join("، ")} maxLength={600} />
      </FormField>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">{t("apply.baseLocation")}</p>
        <p className="text-sm text-gray-600">{t("provider.profile.baseHint")}</p>
        <MapPicker
          lat={point.lat}
          lng={point.lng}
          onChange={(p) => setPoint(p)}
          tileUrl={map.tileUrl}
          tileAttribution={map.tileAttribution}
          defaultLat={map.defaultLat}
          defaultLng={map.defaultLng}
          defaultZoom={map.defaultZoom}
        />
        <input type="hidden" name="lat" value={point.lat ?? ""} />
        <input type="hidden" name="lng" value={point.lng ?? ""} />
      </div>
      <SubmitButton size="lg" fullWidth>{t("provider.profile.save")}</SubmitButton>
    </ActionForm>
  );
}
