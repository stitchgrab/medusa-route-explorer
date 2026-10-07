import * as vscode from "vscode"
import {
  ApiRoute,
  GroupBy,
  RouteTreeNode,
  buildRouteTree,
  filterRoutes,
  methodPresentation,
  parseRouteFile,
  routeLabel,
} from "./parser"

const GROUP_BY_KEY = "medusaRoutes.groupBy"
const FILTER_KEY = "medusaRoutes.filter"

export class MedusaRouteItem extends vscode.TreeItem {
  constructor(
    public readonly kind: "group" | "route" | "empty",
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly route?: ApiRoute,
    public readonly children: MedusaRouteItem[] = [],
    id?: string
  ) {
    super(label, collapsible)
    this.id = id
    if (kind === "route" && route) {
      this.contextValue = "route"
      this.description = vscode.workspace.asRelativePath(route.file)
      this.tooltip = `${routeLabel(route)}\n${this.description}:${route.line}`
      const presentation = methodPresentation(route.method)
      this.iconPath = new vscode.ThemeIcon(presentation.icon, new vscode.ThemeColor(presentation.color))
      this.command = {
        command: "medusaRoutes.open",
        title: "Open Route",
        arguments: [route],
      }
    } else if (kind === "group") {
      this.contextValue = "group"
      this.iconPath = new vscode.ThemeIcon("folder")
    }
  }
}

export class MedusaRouteTreeProvider implements vscode.TreeDataProvider<MedusaRouteItem> {
  private readonly changeEmitter = new vscode.EventEmitter<MedusaRouteItem | undefined>()
  readonly onDidChangeTreeData = this.changeEmitter.event
  private routes: ApiRoute[] = []
  private groupBy: GroupBy = "namespace"
  private filter = ""
  private loading = false

  constructor(private readonly context: vscode.ExtensionContext) {
    this.groupBy = context.workspaceState.get<GroupBy>(GROUP_BY_KEY) ?? "namespace"
    this.filter = context.workspaceState.get<string>(FILTER_KEY) ?? ""
  }

  getRoutes(): ApiRoute[] {
    return this.routes
  }

  getFilter(): string {
    return this.filter
  }

  getGroupBy(): GroupBy {
    return this.groupBy
  }

  async load(): Promise<void> {
    this.loading = true
    this.changeEmitter.fire(undefined)
    const exclude = "**/node_modules/**"
    const nested = await vscode.workspace.findFiles("**/src/api/**/route.ts", exclude)
    const root = await vscode.workspace.findFiles("**/src/api/route.ts", exclude)
    const uris = [...nested, ...root.filter((uri) => !nested.some((found) => found.fsPath === uri.fsPath))]
    const routes: ApiRoute[] = []
    for (const uri of uris) {
      const bytes = await vscode.workspace.fs.readFile(uri)
      routes.push(...parseRouteFile(uri.fsPath, Buffer.from(bytes).toString("utf8")))
    }
    routes.sort((a, b) => routeLabel(a).localeCompare(routeLabel(b)))
    this.routes = routes
    this.loading = false
    this.changeEmitter.fire(undefined)
  }

  async setFilter(filter: string): Promise<void> {
    this.filter = filter
    await this.context.workspaceState.update(FILTER_KEY, filter)
    this.changeEmitter.fire(undefined)
  }

  async toggleGrouping(): Promise<GroupBy> {
    this.groupBy = this.groupBy === "namespace" ? "method" : "namespace"
    await this.context.workspaceState.update(GROUP_BY_KEY, this.groupBy)
    this.changeEmitter.fire(undefined)
    return this.groupBy
  }

  getTreeItem(element: MedusaRouteItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: MedusaRouteItem): MedusaRouteItem[] {
    if (this.loading && !element) {
      return [new MedusaRouteItem("empty", "Scanning routes…", vscode.TreeItemCollapsibleState.None)]
    }
    if (element?.kind === "group") return element.children
    if (element) return []

    const visible = filterRoutes(this.routes, this.filter)
    if (visible.length === 0) {
      const message = this.routes.length === 0
        ? "No Medusa routes under src/api"
        : "No routes match this filter"
      return [new MedusaRouteItem("empty", message, vscode.TreeItemCollapsibleState.None)]
    }

    const filtering = this.filter.trim().length > 0
    return buildRouteTree(visible, this.groupBy).map((node) => toTreeItem(node, 0, filtering))
  }
}

function toTreeItem(node: RouteTreeNode, depth: number, filtering: boolean): MedusaRouteItem {
  if (node.kind === "route") {
    return new MedusaRouteItem(
      "route",
      node.label,
      vscode.TreeItemCollapsibleState.None,
      node.route,
      [],
      node.id
    )
  }

  const collapsible = filtering || depth === 0
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed
  return new MedusaRouteItem(
    "group",
    node.label,
    collapsible,
    undefined,
    node.children.map((child) => toTreeItem(child, depth + 1, filtering)),
    node.id
  )
}

export function statusMessage(routeCount: number, filter: string, groupBy: GroupBy): string {
  const grouping = groupBy === "method" ? "by method" : "by path"
  const filterText = filter.trim() ? ` · filter "${filter.trim()}"` : ""
  return `${routeCount} route${routeCount === 1 ? "" : "s"} · ${grouping}${filterText}`
}

