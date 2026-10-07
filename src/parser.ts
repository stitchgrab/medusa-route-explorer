export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export type ApiRoute = {
  method: HttpMethod
  path: string
  file: string
  line: number
  namespace: string
}

export type GroupBy = "namespace" | "method"

export type RouteGroup = {
  key: string
  label: string
  routes: ApiRoute[]
}

export type RouteTreeFolder = {
  kind: "folder"
  id: string
  segment: string
  label: string
  count: number
  children: RouteTreeNode[]
}

export type RouteTreeLeaf = {
  kind: "route"
  id: string
  label: string
  route: ApiRoute
}

export type RouteTreeNode = RouteTreeFolder | RouteTreeLeaf

type TrieNode = {
  segment: string
  path: string
  routes: ApiRoute[]
  children: Map<string, TrieNode>
}

const METHOD_PATTERN = HTTP_METHODS.join("|")
const EXPORT_RE = new RegExp(
  `^export\\s+(?:async\\s+)?(?:function\\s+(${METHOD_PATTERN})\\b|const\\s+(${METHOD_PATTERN})\\s*=)`,
  "gm"
)

const METHOD_ORDER = new Map<string, number>(HTTP_METHODS.map((method, index) => [method, index]))

const METHOD_PRESENTATION: Record<HttpMethod, { icon: string; color: string }> = {
  GET: { icon: "eye", color: "charts.blue" },
  POST: { icon: "add", color: "charts.green" },
  PUT: { icon: "replace", color: "charts.orange" },
  PATCH: { icon: "edit", color: "charts.yellow" },
  DELETE: { icon: "trash", color: "charts.red" },
  OPTIONS: { icon: "info", color: "charts.purple" },
}

export function methodPresentation(method: HttpMethod): { icon: string; color: string } {
  return METHOD_PRESENTATION[method]
}

export function routePathFromFile(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/")
  const marker = "/src/api/"
  const index = normalized.lastIndexOf(marker)
  if (index === -1) return undefined

  const relative = normalized.slice(index + marker.length)
  if (relative === "route.ts") return "/"
  if (!relative.endsWith("/route.ts")) return undefined

  const segments = relative
    .slice(0, -"/route.ts".length)
    .split("/")
    .filter(Boolean)
    .map(segmentToParam)

  return `/${segments.join("/")}`
}

export function namespaceFromPath(apiPath: string): string {
  return apiPath.split("/").filter(Boolean)[0] ?? "(root)"
}

export function parseRouteFile(filePath: string, source: string): ApiRoute[] {
  const apiPath = routePathFromFile(filePath)
  if (!apiPath) return []

  const routes: ApiRoute[] = []
  for (const match of source.matchAll(EXPORT_RE)) {
    const method = (match[1] || match[2]) as HttpMethod
    const line = source.slice(0, match.index ?? 0).split("\n").length
    routes.push({
      method,
      path: apiPath,
      file: filePath,
      line,
      namespace: namespaceFromPath(apiPath),
    })
  }
  return routes
}

export function compareRoutes(a: ApiRoute, b: ApiRoute): number {
  const byNamespace = a.namespace.localeCompare(b.namespace)
  if (byNamespace !== 0) return byNamespace
  const byPath = a.path.localeCompare(b.path)
  if (byPath !== 0) return byPath
  return (METHOD_ORDER.get(a.method) ?? 0) - (METHOD_ORDER.get(b.method) ?? 0)
}

export function filterRoutes(routes: ApiRoute[], query: string): ApiRoute[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return routes
  return routes.filter((route) => {
    const label = `${route.method} ${route.path}`.toLowerCase()
    return (
      label.includes(needle) ||
      route.namespace.toLowerCase().includes(needle) ||
      route.file.toLowerCase().includes(needle)
    )
  })
}

export function groupRoutes(routes: ApiRoute[], by: GroupBy): RouteGroup[] {
  const buckets = new Map<string, ApiRoute[]>()
  for (const route of routes) {
    const key = by === "method" ? route.method : route.namespace
    const list = buckets.get(key)
    if (list) list.push(route)
    else buckets.set(key, [route])
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    if (by === "method") {
      return (METHOD_ORDER.get(a) ?? 99) - (METHOD_ORDER.get(b) ?? 99)
    }
    return a.localeCompare(b)
  })

  return keys.map((key) => {
    const grouped = buckets.get(key) ?? []
    return {
      key,
      label: `${key} (${grouped.length})`,
      routes: grouped.slice().sort(compareRoutes),
    }
  })
}

export function routeLabel(route: ApiRoute): string {
  return `${route.method} ${route.path}`
}

export function buildRouteTree(routes: ApiRoute[], by: GroupBy): RouteTreeNode[] {
  if (by === "method") {
    return groupRoutes(routes, "method").map((group) => ({
      kind: "folder",
      id: `method:${group.key}`,
      segment: group.key,
      label: group.label,
      count: group.routes.length,
      children: nestRoutes(group.routes, `method:${group.key}`, false),
    }))
  }
  return nestRoutes(routes, "path", true)
}

function nestRoutes(routes: ApiRoute[], idPrefix: string, showMethod: boolean): RouteTreeNode[] {
  const rootRoutes: ApiRoute[] = []
  const children = new Map<string, TrieNode>()
  for (const route of routes) {
    const segments = route.path.split("/").filter(Boolean)
    if (segments.length === 0) {
      rootRoutes.push(route)
      continue
    }
    insertRoute(children, route, segments, "")
  }

  return [
    ...sortByMethod(rootRoutes).map((route) => routeLeaf(route, routeLabel(route), idPrefix)),
    ...renderChildren(children, idPrefix, showMethod),
  ]
}

function insertRoute(siblings: Map<string, TrieNode>, route: ApiRoute, segments: string[], parentPath: string): void {
  const [segment, ...rest] = segments
  const path = `${parentPath}/${segment}`
  let node = siblings.get(segment)
  if (!node) {
    node = { segment, path, routes: [], children: new Map() }
    siblings.set(segment, node)
  }
  if (rest.length === 0) node.routes.push(route)
  else insertRoute(node.children, route, rest, path)
}

function renderChildren(children: Map<string, TrieNode>, idPrefix: string, showMethod: boolean): RouteTreeNode[] {
  return [...children.values()].sort((a, b) => compareSegments(a.segment, b.segment)).map((node) => {
    const count = routeCount(node)
    const id = `${idPrefix}:${node.path}`
    if (node.children.size === 0 && node.routes.length === 1) {
      const route = node.routes[0]
      const label = showMethod ? `${route.method} ${node.segment}` : node.segment
      return routeLeaf(route, label, idPrefix)
    }

    const nested = renderChildren(node.children, idPrefix, showMethod)
    return {
      kind: "folder" as const,
      id,
      segment: node.segment,
      label: `${node.segment} (${count})`,
      count,
      children: [...methodLeaves(node.routes, id), ...nested],
    }
  })
}

function methodLeaves(routes: ApiRoute[], idPrefix: string): RouteTreeLeaf[] {
  return sortByMethod(routes).map((route) => routeLeaf(route, route.method, idPrefix))
}

function routeLeaf(route: ApiRoute, label: string, idPrefix: string): RouteTreeLeaf {
  return {
    kind: "route",
    id: `${idPrefix}:${route.method}:${route.path}:${route.line}:${route.file}`,
    label,
    route,
  }
}

function routeCount(node: TrieNode): number {
  let count = node.routes.length
  for (const child of node.children.values()) count += routeCount(child)
  return count
}

function sortByMethod(routes: ApiRoute[]): ApiRoute[] {
  return routes.slice().sort((a, b) => (METHOD_ORDER.get(a.method) ?? 0) - (METHOD_ORDER.get(b.method) ?? 0))
}

function compareSegments(a: string, b: string): number {
  const aParam = a.startsWith(":")
  const bParam = b.startsWith(":")
  if (aParam !== bParam) return aParam ? 1 : -1
  return a.localeCompare(b)
}

function segmentToParam(segment: string): string {
  const match = segment.match(/^\[+(.+?)\]+$/)
  if (!match) return segment
  return `:${match[1].replace(/^\.+/, "")}`
}
