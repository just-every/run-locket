declare module '*mail/src/events/verify.mjs' {
  export function verifyWebhook(input: { provider: string; rawBody: Uint8Array; headers: Headers; key: string; now: number }): Promise<boolean>
}
