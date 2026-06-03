import { z } from "zod";
export declare const AD_CATEGORIES: readonly ["Home", "Cooking", "Travel", "School", "Investing"];
export type AdCategory = (typeof AD_CATEGORIES)[number];
export declare const adCategorySchema: z.ZodEnum<["Home", "Cooking", "Travel", "School", "Investing"]>;
//# sourceMappingURL=ad-categories.d.ts.map