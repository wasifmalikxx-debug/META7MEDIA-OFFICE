import { z } from "zod";

export const etsyReportSchema = z.object({
  listingsCount: z.number().min(0, "Listings count is required"),
  storeName: z.string().min(1, "Store name is required"),
  listingLinks: z.string().min(1, "Please enter listing links"),
  notes: z.string().optional(),
});

export const fbReportSchema = z.object({
  postsCount: z.number().min(0, "Posts count is required"),
  pageNames: z.string().min(1, "Please enter page names"),
  notes: z.string().optional(),
});
