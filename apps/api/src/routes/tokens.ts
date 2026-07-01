/**
 * AetherDEX Token HTTP endpoints
 * Token list, detail, search — queries D1 directly
 */

import { Hono } from "hono"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
}

const tokens = new Hono<{ Bindings: Bindings }>()

/**
 * GET /api/v1/tokens?verified=true&search=eth&limit=100
 */
tokens.get("/", async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "100", 10), 500)
  const verified = c.req.query("verified") === "true"
  const search = c.req.query("search")

  try {
    let query = `
      SELECT address, symbol, name, decimals, logo_url, is_verified, is_native,
             total_supply, created_at, updated_at
      FROM tokens
    `
    const conditions: string[] = []
    const bindings: (string | number)[] = []

    if (verified) {
      conditions.push("is_verified = 1")
    }

    if (search && search.length >= 2) {
      conditions.push("(LOWER(symbol) LIKE ? OR LOWER(name) LIKE ?)")
      const searchPattern = `%${search.toLowerCase()}%`
      bindings.push(searchPattern, searchPattern)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`
    }

    query += " ORDER BY is_verified DESC, symbol ASC LIMIT ?"
    bindings.push(limit)

    const result = await c.env.DB.prepare(query)
      .bind(...bindings)
      .all<{
        address: string
        symbol: string
        name: string
        decimals: number
        logo_url: string | null
        is_verified: number
        is_native: number
        total_supply: string | null
        created_at: number
        updated_at: number
      }>()

    const tokenList = (result.results ?? []).map((row) => ({
      address: row.address,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      logoUrl: row.logo_url,
      isVerified: Boolean(row.is_verified),
      isNative: Boolean(row.is_native),
      totalSupply: row.total_supply,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return c.json({ tokens: tokenList, count: tokenList.length })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

/**
 * GET /api/v1/tokens/:address
 */
tokens.get("/:address", async (c) => {
  const address = c.req.param("address")
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid token address" }, 400)
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT address, symbol, name, decimals, logo_url, is_verified, is_native,
              total_supply, created_at, updated_at
       FROM tokens WHERE address = ?`,
    )
      .bind(address)
      .first<{
        address: string
        symbol: string
        name: string
        decimals: number
        logo_url: string | null
        is_verified: number
        is_native: number
        total_supply: string | null
        created_at: number
        updated_at: number
      }>()

    if (!result) {
      return c.json({ error: "Token not found" }, 404)
    }

    return c.json({
      token: {
        address: result.address,
        symbol: result.symbol,
        name: result.name,
        decimals: result.decimals,
        logoUrl: result.logo_url,
        isVerified: Boolean(result.is_verified),
        isNative: Boolean(result.is_native),
        totalSupply: result.total_supply,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
      },
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { tokens }
