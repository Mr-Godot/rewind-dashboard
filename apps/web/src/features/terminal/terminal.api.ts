import { createServerFn } from '@tanstack/react-start'
import { detectTerminalsSync, type DetectionResult } from '@/lib/launch/terminal-detect'

/**
 * Detection is a plain read with no spawn side effect, so it is a normal server
 * function rather than something hidden behind the launch endpoint. The probe
 * itself is cached for the life of the server process.
 */

export const detectTerminals = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DetectionResult> => detectTerminalsSync(),
)

export const redetectTerminals = createServerFn({ method: 'POST' }).handler(
  async (): Promise<DetectionResult> => detectTerminalsSync({ force: true }),
)
