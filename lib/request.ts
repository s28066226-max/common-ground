import { z } from "zod";
import { AGE_BUCKETS } from "./qloo";

export const PlanRequestSchema = z.object({
  people: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        loves: z.string().trim().min(2).max(400),
        age: z.enum(AGE_BUCKETS).optional(),
      }),
    )
    .min(2)
    .max(6)
    .refine((ps) => new Set(ps.map((p) => p.name.toLowerCase())).size === ps.length, "Names must be unique"),
  occasion: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  budget: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
  notes: z.string().trim().max(300).optional(),
});
