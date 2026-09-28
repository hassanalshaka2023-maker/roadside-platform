import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field, Notice } from "@/components/ui/States";
import { PASSWORD_MIN_LENGTH } from "@/features/admin/account";
import { changeOwnCredentialsAction } from "@/features/admin/actions";
import { requirePermission } from "@/lib/auth/current-user";

/** Any admin: change one's own sign-in email and password. */
export default async function AdminAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requirePermission(locale, "manageOwnAccount", "admin");
  const t = await getTranslations("admin");

  const field = (name: string, label: string, props: React.ComponentProps<typeof Input>, hint?: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      <Input name={name} dir="ltr" {...props} />
      {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
    </label>
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl">{t("accountTitle")}</h1>

      <Card>
        <CardHeader><CardTitle>{t("accountCurrent")}</CardTitle></CardHeader>
        <CardBody>
          <dl className="text-sm">
            <Field label={t("accountEmail")}><span dir="ltr">{user.email}</span></Field>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("accountChange")}</CardTitle></CardHeader>
        <CardBody>
          <ActionForm action={changeOwnCredentialsAction} successMessage="admin.accountSaved" resetOnSuccess>
            {field("email", t("accountNewEmail"), { type: "email", autoComplete: "username", placeholder: user.email ?? "" }, t("accountKeepHint"))}
            {field(
              "newPassword",
              t("accountNewPassword"),
              { type: "password", autoComplete: "new-password", minLength: PASSWORD_MIN_LENGTH },
              t("accountPasswordHint", { min: PASSWORD_MIN_LENGTH }),
            )}
            {field("confirmPassword", t("accountConfirmPassword"), { type: "password", autoComplete: "new-password" })}
            <hr className="border-gray-100" />
            {field("currentPassword", t("accountCurrentPassword"), { type: "password", autoComplete: "current-password", required: true })}
            <Notice tone="info">{t("accountSessionsNote")}</Notice>
            <SubmitButton>{t("save")}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
