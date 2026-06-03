import { z } from "zod";

export const AD_CATEGORIES = ["Home", "Cooking", "Travel", "School", "Investing"] as const;

export type AdCategory = (typeof AD_CATEGORIES)[number];

export const adCategorySchema = z.enum(AD_CATEGORIES);
