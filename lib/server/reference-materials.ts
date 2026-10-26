import pageData from "../../content/pages.json";
import type { ContentPage, StageContent, Zone } from "../content";
import { REFERENCE_IDS, type ReferenceMaterial, type ReferenceZone } from "../reference-materials";

function publicZone(zone: Zone): ReferenceZone {
  return {
    k: zone.k, ex: zone.ex, ctx: zone.ctx, lis: zone.lis,
    ...(typeof zone.subj === "string" ? { subj: zone.subj } : {}),
    ...(typeof zone.item === "string" ? { item: zone.item } : {}),
    ...(typeof zone.a === "string" ? { a: zone.a } : {}),
    ...(typeof zone.b === "string" ? { b: zone.b } : {}),
  };
}

/** Only publicly published sense-stage text crosses the workspace's server/client boundary. */
export function getPublicReferenceMaterials(): ReferenceMaterial[] {
  return REFERENCE_IDS.map((id) => {
    const page = (pageData as ContentPage[]).find((page) => page.path === `${id}/`);
    const stage = page?.parts.find((part): part is StageContent => part.kind === "stage" && part.word === id);
    const separator = page?.h1?.indexOf(":") ?? -1;
    if (!page?.h1 || !stage || separator < 1) throw new Error("reference_material_unavailable");
    return {
      id, title: page.h1.slice(0, separator).trim(), sense: page.h1.slice(separator + 1).trim(),
      description: stage.description.replace(/^버튼을 눌러 보십시오\.\s*/, ""), href: `/${id}/`, zones: stage.zones.map(publicZone),
      ...(id === "have" ? {
        image: {
          src: "/assets/learning/have-sense.webp",
          alt: "사람을 둘러싼 연두색 타원 안에 손전등, 하트, 시계, 가슴에 구름이 있는 몸 모양, 체크리스트와 발자국이 놓여 있다.",
        },
      } : {}),
    };
  });
}
