import { z } from 'zod'

// Translations JSONB shape — kept flat to avoid Gemini schema validation failures (Pitfall 3)
// Zod v4: z.record requires two args (key schema, value schema)
const TranslationsSchema = z.record(z.string(), z.any())

// For bulk menu seed (type='menu') and category-only seed (type='categories')
export const MenuSeedSchema = z.object({
  categories: z.array(z.object({
    name: z.string(),
    description: z.string(),
    translations: TranslationsSchema.optional(),
    products: z.array(z.object({
      name: z.string(),
      description: z.string(),
      price: z.number(),
      translations: TranslationsSchema.optional(),
    })),
  })),
})

// For categories-only seed (type='categories') — same shape but products array empty
// MenuSeedSchema handles both; products array may be empty for categories-only calls.

// For copy seed (type='copy') — AI-04
export const CopySeedSchema = z.object({
  tagline: z.string(),
  about: z.string(),
})

// For single category seed (type='single_category') — AI-06
export const SingleCategorySeedSchema = z.object({
  name: z.string(),
  description: z.string(),
  translations: TranslationsSchema.optional(),
})

// For single product seed (type='single_product') — AI-06
export const SingleProductSeedSchema = z.object({
  name: z.string(),
  description: z.string(),
  price: z.number(),
  translations: TranslationsSchema.optional(),
})

export type MenuSeedResult = z.infer<typeof MenuSeedSchema>
export type CopySeedResult = z.infer<typeof CopySeedSchema>
export type SingleCategorySeedResult = z.infer<typeof SingleCategorySeedSchema>
export type SingleProductSeedResult = z.infer<typeof SingleProductSeedSchema>
