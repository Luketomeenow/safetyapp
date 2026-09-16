import { z } from "zod";

export const ChatRequestSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  client_message_id: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
  device_id: z.string().max(100).optional(),
  client_version: z.string().max(50).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const FeedbackRequestSchema = z
  .object({
    message_id: z.string().uuid(),
    rating: z.enum(["up", "down"]).optional(),
    flag: z.enum(["wrong", "unsafe", "wrongly_not_covered", "other"]).optional(),
    comment: z.string().max(2000).optional(),
  })
  .refine((v) => v.rating !== undefined || v.flag !== undefined, {
    message: "rating or flag is required",
  });
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const ManualCurrentResponseSchema = z.object({
  version_id: z.string(),
  effective_date: z.string(),
  page_count: z.number().int(),
  body_start_page: z.number().int(),
  pdf_sha256: z.string(),
  pages_sha256: z.string(),
  size_bytes: z.number().int(),
  pdf_url: z.string().url(),
  programs: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      start_page: z.number().int(),
      end_page: z.number().int(),
    }),
  ),
  sections: z.array(
    z.object({ number: z.string(), title: z.string(), start_page: z.number().int() }),
  ),
});
export type ManualCurrentResponse = z.infer<typeof ManualCurrentResponseSchema>;

export const ConfigResponseSchema = z.object({
  emergency_contacts: z.array(
    z.object({ label: z.string(), tel: z.string(), note: z.string().optional() }),
  ),
  disclaimer_version: z.string(),
  min_app_version: z.string(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;
