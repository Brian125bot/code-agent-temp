import { z } from 'zod'

export const planStepSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['edit', 'create', 'delete', 'run_cmd', 'run_tests']),
  files: z.array(z.string()).optional(),
  rationale: z.string().min(1),
  risk: z.enum(['low', 'medium', 'high']),
})

export const planSchema = z.object({
  goal: z.string().min(1),
  assumptions: z.array(z.string()),
  steps: z.array(planStepSchema).min(1),
  estimated_files_changed: z.number().int().min(0),
  estimated_loc: z.number().int().min(0),
  test_command: z.string().optional(),
})

export type PlanResult = z.infer<typeof planSchema>
export type PlanStep = z.infer<typeof planStepSchema>
