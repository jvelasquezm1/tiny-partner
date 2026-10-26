import { z } from "zod";

export const EventKindSchema = z.enum(["feed", "sleep", "diaper"]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const BabyEventSchema = z.object({
  kind: EventKindSchema,
  startedAt: z.string().describe("ISO 8601 timestamp with offset"),
  endedAt: z.string().nullable().describe("ISO 8601 timestamp with offset, null when not stated"),
  amountMl: z.number().int().nullable().describe("Bottle volume in ml, null for breastfeeding or unknown"),
  side: z.enum(["left", "right", "both"]).nullable(),
  diaper: z.enum(["wet", "dirty", "both"]).nullable(),
  note: z.string().nullable(),
});
export type BabyEvent = z.infer<typeof BabyEventSchema>;
