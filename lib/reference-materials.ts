/** Public reference shapes only; answer-bearing page data stays on the server. */
export const REFERENCE_IDS = ["have", "get", "be", "go"] as const;
export type ReferenceId = typeof REFERENCE_IDS[number];

export type ReferenceZone = {
  k: string;
  ex: string;
  ctx: string;
  lis: string;
  subj?: string;
  item?: string;
  a?: string;
  b?: string;
};

export type ReferenceMaterial = {
  id: ReferenceId;
  title: string;
  sense: string;
  description: string;
  href: string;
  zones: ReferenceZone[];
  image?: { src: string; alt: string };
};
