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

/** What the extractor returns: the event, plus whether its clock time could be morning or evening. */
export const ExtractedEventSchema = BabyEventSchema.extend({
  ambiguousTime: z
    .boolean()
    .describe(
      'True when the message gives a clock time without saying whether it is morning or evening ("a las 9", "at 3", "de 2 a 4"). False for 24-hour times (21h, 15:30), am/pm, de la mañana/tarde/noche, relative times and no time at all',
    ),
});
export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;
