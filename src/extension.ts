import * as vscode from "vscode"
import { ApiRoute, filterRoutes, routeLabel } from "./parser"
import { MedusaRouteItem, MedusaRouteTreeProvider, statusMessage } from "./tree"

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MedusaRouteTreeProvider(context)
  const view = vscode.window.createTreeView("medusaRouteExplorer", {
    treeDataProvider: provider,
    showCollapseAll: true,
  })

  const refreshMessage = () => {
    const visible = filterRoutes(provider.getRoutes(), provider.getFilter())
    view.message = statusMessage(visible.length, provider.getFilter(), provider.getGroupBy())
  }

  const load = async () => {
    await provider.load()
    refreshMessage()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const scheduleLoad = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void load()
    }, 200)
  }

  const watcher = vscode.workspace.createFileSystemWatcher("**/src/api/**/route.ts")
  context.subscriptions.push(
    view,
    watcher,
    watcher.onDidCreate(scheduleLoad),
    watcher.onDidChange(scheduleLoad),
    watcher.onDidDelete(scheduleLoad),
    vscode.commands.registerCommand("medusaRoutes.refresh", () => load()),
    vscode.commands.registerCommand("medusaRoutes.toggleGrouping", async () => {
      const groupBy = await provider.toggleGrouping()
      refreshMessage()
      const label = groupBy === "method" ? "HTTP method" : "path"
      vscode.window.setStatusBarMessage(`Medusa routes grouped by ${label}`, 2000)
    }),
    vscode.commands.registerCommand("medusaRoutes.filter", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "Filter Medusa routes by method, path, or file",
        value: provider.getFilter(),
        placeHolder: "vendors/products or POST",
      })
      if (value === undefined) return
      await provider.setFilter(value)
      refreshMessage()
    }),
    vscode.commands.registerCommand("medusaRoutes.copyPath", async (item?: MedusaRouteItem) => {
      const route = item?.route ?? (await pickRoute(provider.getRoutes()))
      if (!route) return
      const text = routeLabel(route)
      await vscode.env.clipboard.writeText(text)
      vscode.window.setStatusBarMessage(`Copied ${text}`, 2000)
    }),
    vscode.commands.registerCommand("medusaRoutes.open", async (route?: ApiRoute) => {
      const target = route ?? (await pickRoute(provider.getRoutes()))
      if (target) await openRoute(target)
    }),
    vscode.commands.registerCommand("medusaRoutes.goTo", async () => {
      const route = await pickRoute(provider.getRoutes())
      if (route) await openRoute(route)
    })
  )

  void load()
}

export function deactivate(): void {}

async function openRoute(route: ApiRoute): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(route.file))
  const editor = await vscode.window.showTextDocument(document, { preview: false })
  const position = new vscode.Position(Math.max(0, route.line - 1), 0)
  editor.selection = new vscode.Selection(position, position)
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
}

async function pickRoute(routes: ApiRoute[]): Promise<ApiRoute | undefined> {
  const picked = await vscode.window.showQuickPick(
    routes.map((route) => ({
      label: routeLabel(route),
      description: `${vscode.workspace.asRelativePath(route.file)}:${route.line}`,
      route,
    })),
    {
      matchOnDescription: true,
      placeHolder: "Jump to a Medusa route",
    }
  )
  return picked?.route
}
