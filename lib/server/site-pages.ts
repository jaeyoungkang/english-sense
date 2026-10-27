import { contentPages } from "../content";
import { studyPages } from "./study-source";

/** 공개 페이지 전체. pages.json 다음에 읽기·사전 훈련 페이지가 온다. */
export const pages = [...contentPages, ...studyPages()];
export function getPage(slug: string[] = []) {
  const path = slug.length ? `${slug.join("/")}/` : "";
  return pages.find((page) => page.path === path);
}
