import { getTranslations } from "next-intl/server";

import { Notice } from "@/components/ui/States";

interface Section {
  title: string;
  body: string[];
}

/**
 * Renders a legal page from messages/*.json (`legal.<page>`), so the text is
 * translated like everything else and a lawyer can review one file.
 */
export async function LegalPage({ page }: { page: "terms" | "privacy" }) {
  const t = await getTranslations("legal");
  const sections = t.raw(`${page}.sections`) as Section[];

  return (
    <article className="container max-w-3xl py-10">
      <h1 className="text-2xl sm:text-3xl">{t(`${page}.title`)}</h1>
      <p className="mt-2 text-sm text-gray-500">{t("updated")}</p>
      <div className="mt-4">
        <Notice tone="warning">{t("draftNotice")}</Notice>
      </div>
      {sections.map((section) => (
        <section key={section.title} className="mt-8">
          <h2 className="text-xl">{section.title}</h2>
          {section.body.map((paragraph, index) => (
            <p key={index} className="mt-3 leading-relaxed text-gray-800">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
