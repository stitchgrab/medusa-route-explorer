# Medusa Route Explorer

Cursor and VS Code sidebar for Medusa file routes under `src/api/**/route.ts`.

OctAPI only keeps files inside `app/api` or `pages/api`. Medusa maps `src/api/vendors/products/[id]/route.ts` to `GET /vendors/products/:id`, so those routes never show up there.

This extension reads the exported `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS` handlers, lists them in the activity bar, and opens the handler when you click a route.

## Use

1. Open a workspace that contains `core-api` (or any Medusa app with `src/api`).
2. Open the **Medusa Routes** view.
3. Click a route to jump to its export. The copy icon copies `METHOD /path`.
4. Namespaces such as `admin` and `vendors` open into their path folders (`cms`, `drivers`, `:id`, and so on). Handlers for that exact path are listed as `GET` and `POST` inside the folder. Use the view actions to filter, group by path or HTTP method, and refresh.
5. Command palette: **Medusa Routes: Go to Route**.

Core Medusa routes inside `node_modules` are not listed. The view covers custom routes under `src/api`.

## Contributing

Open a pull request. `main` is protected, and changes need an approving review from [@domfelix9](https://github.com/domfelix9) before they can merge.

## Develop

```bash
npm install
npm test
npm run compile
```

Press F5 in this folder to launch an Extension Development Host.
