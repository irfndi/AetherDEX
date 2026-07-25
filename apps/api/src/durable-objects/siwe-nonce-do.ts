type NonceRecord = {
  readonly expiresAt: number
}

type NonceRequest = {
  readonly nonce: string
  readonly expiresAt: number
}

export class SiweNonceDO implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })

    const path = new URL(request.url).pathname
    if (path === "/issue") return this.issue(await this.parseRequest(request))
    if (path === "/consume") return this.consume()
    return new Response("Not found", { status: 404 })
  }

  private async parseRequest(request: Request): Promise<NonceRequest> {
    const body = (await request.json()) as Partial<NonceRequest>
    if (typeof body.nonce !== "string" || !/^[a-f0-9]{32}$/.test(body.nonce)) throw new Error("Invalid nonce")
    if (typeof body.expiresAt !== "number" || !Number.isSafeInteger(body.expiresAt)) {
      throw new Error("Invalid nonce expiry")
    }
    return { nonce: body.nonce, expiresAt: body.expiresAt }
  }

  private async issue(input: NonceRequest): Promise<Response> {
    await this.ctx.storage.put<NonceRecord>("record", { expiresAt: input.expiresAt })
    await this.ctx.storage.setAlarm(input.expiresAt)
    return Response.json({ consumed: false }, { status: 201 })
  }

  private async consume(): Promise<Response> {
    const consumed = await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.ctx.storage.get<NonceRecord>("record")
      if (!record || record.expiresAt <= Date.now()) {
        if (record) await this.ctx.storage.delete("record")
        await this.ctx.storage.deleteAlarm()
        return false
      }
      await this.ctx.storage.delete("record")
      await this.ctx.storage.deleteAlarm()
      return true
    })
    return Response.json({ consumed })
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const record = await this.ctx.storage.get<NonceRecord>("record")
      if (!record || record.expiresAt <= Date.now()) {
        await this.ctx.storage.delete("record")
        await this.ctx.storage.deleteAlarm()
        return
      }
      await this.ctx.storage.setAlarm(record.expiresAt)
    })
  }
}
