import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  ApiRoute,
  buildRouteTree,
  filterRoutes,
  groupRoutes,
  parseRouteFile,
  routePathFromFile,
  RouteTreeNode,
} from "./parser"

const CORE_API = path.resolve(__dirname, "../../core-api/src/api")

test("maps route.ts folders onto URL paths", () => {
  assert.equal(routePathFromFile("/repo/src/api/route.ts"), "/")
  assert.equal(routePathFromFile("/repo/src/api/logo/route.ts"), "/logo")
  assert.equal(
    routePathFromFile("/repo/src/api/vendors/products/[id]/variants/route.ts"),
    "/vendors/products/:id/variants"
  )
  assert.equal(
    routePathFromFile("C:\\repo\\src\\api\\webhooks\\shopify\\inventory\\[vendorId]\\route.ts"),
    "/webhooks/shopify/inventory/:vendorId"
  )
  assert.equal(routePathFromFile("/repo/src/api/middlewares.ts"), undefined)
  assert.equal(routePathFromFile("/repo/src/app/api/health/route.ts"), undefined)
})

test("reads both export styles and ignores comments", () => {
  const source = `
// export const GET = async () => {}
export const OPTIONS = async (
  _req: unknown,
  res: unknown
) => res

export async function POST(req: unknown, res: unknown) {}

const GET = async () => {}
`
  const routes = parseRouteFile("/repo/src/api/analytics/track/route.ts", source)
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}:${route.line}`),
    ["OPTIONS /analytics/track:3", "POST /analytics/track:8"]
  )
  assert.equal(routes[0]?.namespace, "analytics")
})

test("groups by namespace and filters by path", () => {
  const routes = parseRouteFile(
    "/repo/src/api/vendors/products/[id]/route.ts",
    "export const GET = async () => {}\nexport const POST = async () => {}\n"
  ).concat(
    parseRouteFile("/repo/src/api/store/custom/route.ts", "export async function DELETE() {}\n")
  )

  assert.deepEqual(
    groupRoutes(routes, "namespace").map((group) => group.label),
    ["store (1)", "vendors (2)"]
  )
  assert.deepEqual(
    groupRoutes(routes, "method").map((group) => group.key),
    ["GET", "POST", "DELETE"]
  )
  assert.equal(filterRoutes(routes, "products/:id").length, 2)
  assert.equal(filterRoutes(routes, "delete /store").length, 1)
})

test("nests each namespace by path segment", () => {
  const routes = [
    ...handlers("/repo/src/api/admin/cms/stats/route.ts", "export const GET = async () => {}\n"),
    ...handlers(
      "/repo/src/api/admin/cms/content-types/route.ts",
      "export const GET = async () => {}\nexport const POST = async () => {}\n"
    ),
    ...handlers(
      "/repo/src/api/admin/cms/content-types/[id]/route.ts",
      "export const DELETE = async () => {}\n"
    ),
    ...handlers("/repo/src/api/admin/vendors/route.ts", "export const GET = async () => {}\n"),
    ...handlers("/repo/src/api/vendors/products/route.ts", "export const GET = async () => {}\n"),
  ]

  assert.deepEqual(outline(buildRouteTree(routes, "namespace")), [
    "admin (5)",
    "  cms (4)",
    "    content-types (3)",
    "      GET",
    "      POST",
    "      DELETE :id",
    "    GET stats",
    "  GET vendors",
    "vendors (1)",
    "  GET products",
  ])
})

test("indexes every custom route in core-api", async () => {
  const files = await listRouteFiles(CORE_API)
  assert.ok(files.length >= 200, `expected route files, found ${files.length}`)

  const discovered: string[] = []
  const parsed: ApiRoute[] = []
  let expected = 0
  const lineExport =
    /^export\s+(?:async\s+)?(?:function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b|const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*=)/

  for (const file of files) {
    const source = await readFile(file, "utf8")
    const routes = parseRouteFile(file, source)
    parsed.push(...routes)
    for (const route of routes) {
      discovered.push(`${route.method} ${route.path}`)
    }

    const lines = source.split("\n")
    lines.forEach((line, index) => {
      const match = lineExport.exec(line)
      if (!match) return
      expected += 1
      const method = match[1] || match[2]
      const found = routes.find((route) => route.method === method && route.line === index + 1)
      assert.ok(found, `${file}:${index + 1} ${method}`)
    })
  }

  assert.equal(discovered.length, expected)
  assert.ok(discovered.includes("GET /"))
  assert.ok(discovered.includes("GET /vendors/products/:id/variants"))
  assert.ok(discovered.includes("GET /logo"))

  const tree = buildRouteTree(parsed, "namespace")
  const admin = tree.find((node) => node.kind === "folder" && node.segment === "admin")
  assert.ok(admin && admin.kind === "folder")
  assert.ok(admin.children.some((child) => child.kind === "folder"))
  assert.ok(admin.children.length < admin.count)
})

function handlers(file: string, source: string): ApiRoute[] {
  return parseRouteFile(file, source)
}

function outline(nodes: RouteTreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const line = `${"  ".repeat(depth)}${node.label}`
    return node.kind === "folder" ? [line, ...outline(node.children, depth + 1)] : [line]
  })
}

async function listRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listRouteFiles(fullPath)))
    } else if (entry.name === "route.ts") {
      files.push(fullPath)
    }
  }
  return files
}
