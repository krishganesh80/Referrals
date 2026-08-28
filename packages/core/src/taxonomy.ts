// The GP selects an anatomical region and a broad category. This table turns that pair into an
// ordered list of sub-specialty buckets to filter on.
//
// THIS IS THE ONE PLACE IN THE PRODUCT THAT COULD DRIFT INTO CLINICAL INTERPRETATION, so it is
// built as a literal table and nothing else. There is no logic here — no defaulting, no
// fallback chain, no inference from the region to the category. Every (region, category) pair
// is written out, and a test asserts the table is total, so a new region or category cannot be
// added without someone deciding, in writing, where it points.
//
// The rows are directory taxonomy, not clinical advice: they say which kind of surgeon lists
// that kind of work, not what is wrong with the patient. They still need clinical review before
// launch — flagged to the founder.
//
// Order within a row is meaningful. The first bucket is the primary reading of that pair and
// scores full weight; later buckets are adjacent practice and score less. See `matcher.ts`.

import type { Subspecialty } from "./schema";
import { SUBSPECIALTIES } from "./schema";
import { z } from "zod";

export const ANATOMICAL_REGIONS = [
  "hip",
  "knee",
  "shoulder",
  "elbow",
  "wrist_hand",
  "foot_ankle",
  "spine",
  "pelvis",
  "general",
] as const;
export const AnatomicalRegionSchema = z.enum(ANATOMICAL_REGIONS);
export type AnatomicalRegion = z.infer<typeof AnatomicalRegionSchema>;

/**
 * Broad, GP-selectable categories. Deliberately coarse: these are the words a referrer already
 * uses to say what kind of work they are asking for. None of them is a diagnosis and the tool
 * never asks for one.
 */
export const REFERRAL_CATEGORIES = [
  "joint_replacement",
  "sports_soft_tissue",
  "trauma_fracture",
  "deformity_reconstruction",
  "nerve_compression",
  "tumour",
  "paediatric",
  "unspecified",
] as const;
export const ReferralCategorySchema = z.enum(REFERRAL_CATEGORIES);
export type ReferralCategory = z.infer<typeof ReferralCategorySchema>;

export const REGION_COPY: Readonly<Record<AnatomicalRegion, string>> = {
  hip: "Hip",
  knee: "Knee",
  shoulder: "Shoulder",
  elbow: "Elbow",
  wrist_hand: "Wrist & hand",
  foot_ankle: "Foot & ankle",
  spine: "Spine",
  pelvis: "Pelvis",
  general: "Not region-specific",
};

export const CATEGORY_COPY: Readonly<Record<ReferralCategory, string>> = {
  joint_replacement: "Joint replacement",
  sports_soft_tissue: "Sports & soft tissue",
  trauma_fracture: "Trauma & fracture",
  deformity_reconstruction: "Deformity & reconstruction",
  nerve_compression: "Nerve compression",
  tumour: "Tumour",
  paediatric: "Paediatric",
  unspecified: "Not specified",
};

type Row = readonly Subspecialty[];

/**
 * region -> category -> ordered buckets. Written out in full; no row is computed from another.
 */
export const REGION_CATEGORY_TO_BUCKETS: Readonly<
  Record<AnatomicalRegion, Readonly<Record<ReferralCategory, Row>>>
> = {
  hip: {
    joint_replacement: ["hip_knee_arthroplasty"],
    sports_soft_tissue: ["hip_knee_arthroplasty"],
    trauma_fracture: ["trauma_limb_recon", "hip_knee_arthroplasty"],
    deformity_reconstruction: ["trauma_limb_recon", "hip_knee_arthroplasty"],
    nerve_compression: ["hip_knee_arthroplasty"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["hip_knee_arthroplasty"],
  },
  knee: {
    joint_replacement: ["hip_knee_arthroplasty"],
    sports_soft_tissue: ["knee_sports"],
    trauma_fracture: ["trauma_limb_recon", "knee_sports"],
    deformity_reconstruction: ["trauma_limb_recon", "hip_knee_arthroplasty"],
    nerve_compression: ["knee_sports"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["hip_knee_arthroplasty", "knee_sports"],
  },
  shoulder: {
    joint_replacement: ["shoulder_elbow"],
    sports_soft_tissue: ["shoulder_elbow"],
    trauma_fracture: ["trauma_limb_recon", "shoulder_elbow"],
    deformity_reconstruction: ["shoulder_elbow", "trauma_limb_recon"],
    nerve_compression: ["shoulder_elbow"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["shoulder_elbow"],
  },
  elbow: {
    joint_replacement: ["shoulder_elbow"],
    sports_soft_tissue: ["shoulder_elbow"],
    trauma_fracture: ["trauma_limb_recon", "shoulder_elbow"],
    deformity_reconstruction: ["shoulder_elbow", "trauma_limb_recon"],
    // Cubital tunnel work is listed by hand surgeons as often as by elbow surgeons.
    nerve_compression: ["hand_wrist", "shoulder_elbow"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["shoulder_elbow"],
  },
  wrist_hand: {
    joint_replacement: ["hand_wrist"],
    sports_soft_tissue: ["hand_wrist"],
    trauma_fracture: ["hand_wrist", "trauma_limb_recon"],
    deformity_reconstruction: ["hand_wrist", "trauma_limb_recon"],
    nerve_compression: ["hand_wrist"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["hand_wrist"],
  },
  foot_ankle: {
    joint_replacement: ["foot_ankle"],
    sports_soft_tissue: ["foot_ankle"],
    trauma_fracture: ["foot_ankle", "trauma_limb_recon"],
    deformity_reconstruction: ["foot_ankle", "trauma_limb_recon"],
    nerve_compression: ["foot_ankle"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["foot_ankle"],
  },
  spine: {
    joint_replacement: ["spine"],
    sports_soft_tissue: ["spine"],
    trauma_fracture: ["spine", "trauma_limb_recon"],
    deformity_reconstruction: ["spine"],
    nerve_compression: ["spine"],
    tumour: ["tumour", "spine"],
    paediatric: ["paediatric", "spine"],
    unspecified: ["spine"],
  },
  pelvis: {
    joint_replacement: ["hip_knee_arthroplasty"],
    sports_soft_tissue: ["hip_knee_arthroplasty"],
    trauma_fracture: ["trauma_limb_recon"],
    deformity_reconstruction: ["trauma_limb_recon"],
    nerve_compression: ["spine"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: ["trauma_limb_recon", "hip_knee_arthroplasty"],
  },
  general: {
    joint_replacement: ["hip_knee_arthroplasty", "shoulder_elbow"],
    sports_soft_tissue: ["knee_sports", "shoulder_elbow"],
    trauma_fracture: ["trauma_limb_recon"],
    deformity_reconstruction: ["trauma_limb_recon"],
    nerve_compression: ["hand_wrist", "spine"],
    tumour: ["tumour"],
    paediatric: ["paediatric"],
    unspecified: [...SUBSPECIALTIES],
  },
};

/** The buckets a criteria pair filters on, in priority order. Pure table lookup. */
export function bucketsFor(region: AnatomicalRegion, category: ReferralCategory): Row {
  return REGION_CATEGORY_TO_BUCKETS[region][category];
}
