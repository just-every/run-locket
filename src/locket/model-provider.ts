import type { Ctx } from './commands'
import { requestModel as request } from './model-settings'

export async function requestModel(c: Ctx, s: { provider: string; model: string }, prompt: string, input: unknown, maxTokens = 4096): Promise<Response> {
 return request(c.env, s, prompt, input, maxTokens)
}
