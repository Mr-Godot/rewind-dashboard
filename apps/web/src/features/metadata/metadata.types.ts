import { z } from 'zod'

export const SessionMetadataEntrySchema = z.object({
  pinned: z.boolean().optional(),
  customName: z.string().optional(),
})

export const ProjectMetadataEntrySchema = z.object({
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  customName: z.string().optional(),
})

export const MetadataSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime().optional(),
  sessions: z.record(z.string(), SessionMetadataEntrySchema).default({}),
  projects: z.record(z.string(), ProjectMetadataEntrySchema).default({}),
})

export type SessionMetadataEntry = z.infer<typeof SessionMetadataEntrySchema>
export type ProjectMetadataEntry = z.infer<typeof ProjectMetadataEntrySchema>
export type Metadata = z.infer<typeof MetadataSchema>

export const DEFAULT_METADATA: Metadata = {
  version: 1,
  sessions: {},
  projects: {},
}
