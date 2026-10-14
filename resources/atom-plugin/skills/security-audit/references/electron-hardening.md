# Electron hardening checklist

Electron combines a web renderer with Node.js and OS access. The core rule: **the renderer is untrusted**. It
displays content (Markdown, HTML previews, remote pages, extension output) that may contain attacker-controlled
data, so a single XSS must not be able to escalate to file-system or shell access. All privilege lives in the main
process behind a small, validated IPC surface.

Reference: the official Electron security checklist (https://www.electronjs.org/docs/latest/tutorial/security).

## 1. BrowserWindow / webPreferences

```ts
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, "../preload/index.js"),
    contextIsolation: true,      // default since Electron 12 - never set false
    nodeIntegration: false,      // default - never true for windows showing any untrusted content
    sandbox: true,               // default since Electron 20 for renderers; keep it on
    webSecurity: true,           // never disable (it turns off same-origin policy)
    allowRunningInsecureContent: false,
    webviewTag: false,           // enable only if needed, then validate in will-attach-webview
    experimentalFeatures: false,
  },
});
```

Audit: Grep for `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false`,
`nodeIntegrationInSubFrames`, `nodeIntegrationInWorker`, `enableRemoteModule`, `@electron/remote`.

## 2. Preload and contextBridge

Expose narrow, purpose-specific functions. Never expose `ipcRenderer`, `require`, `fs`, `child_process` or a generic
"invoke any channel" function - that hands the renderer the whole main-process API.

```ts
// Bad: renderer can call any channel with any arguments
contextBridge.exposeInMainWorld("electron", { ipcRenderer });
contextBridge.exposeInMainWorld("api", { invoke: (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a) });

// Good: fixed channels, typed arguments, no raw event objects leaked to the page
contextBridge.exposeInMainWorld("api", {
  readWorkspaceFile: (relPath: string) => ipcRenderer.invoke("fs:readWorkspaceFile", relPath),
  onFileChanged: (cb: (path: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on("fs:fileChanged", listener);
    return () => ipcRenderer.removeListener("fs:fileChanged", listener);
  },
});
```

## 3. IPC handlers in main

Every `ipcMain.handle` / `ipcMain.on` is a privileged API endpoint. For each:

- **Validate the sender**: check `event.senderFrame` belongs to your app (expected URL/origin), so content loaded
  in other frames or windows cannot call it.
- **Validate arguments** with a schema (zod, valibot, ajv). Types from TypeScript do not exist at runtime.
- **Authorize the operation**: file paths must stay inside the workspace (resolve + containment check), commands
  must come from an allowlist, URLs must be allowlisted.
- Return plain data, not objects with methods or internal state; do not leak absolute paths or secrets unnecessarily.

```ts
import { z } from "zod";

const ReadArgs = z.string().min(1).max(4096);

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? "";
  const ok = url.startsWith("file://") || url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "\u0000");
  if (!ok) throw new Error("Untrusted IPC sender");
}

ipcMain.handle("fs:readWorkspaceFile", async (event, raw) => {
  assertTrustedSender(event);
  const relPath = ReadArgs.parse(raw);
  const root = path.resolve(currentWorkspace());
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path outside workspace");
  return fs.promises.readFile(target, "utf8");
});
```

Adapt `assertTrustedSender` to how the app loads its UI (custom `app://` protocol, dev-server URL in development only).

## 4. Navigation and new windows

```ts
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };                    // never let untrusted content open Electron windows
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();   // keep the main window on the app's own origin
  });
  contents.on("will-attach-webview", (event, webPreferences) => {
    delete webPreferences.preload;                // or event.preventDefault() if webviews are not used
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
});

function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}
```

`shell.openExternal` with `file:`, `smb:` or custom schemes can execute programs on some platforms - allowlist
protocols. `shell.openPath` on attacker-chosen paths can run executables - validate them too.

## 5. Content Security Policy

Set a CSP for all app pages (meta tag or `session.defaultSession.webRequest.onHeadersReceived`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

Avoid `'unsafe-eval'` and remote `script-src`. Monaco and some libraries need workers (`worker-src 'self' blob:`) -
add the minimum required.

## 6. Rendering untrusted content

- Markdown/HTML from AI output, files, or the network: sanitize (DOMPurify) before inserting; disable raw HTML in the
  Markdown renderer unless sanitized; restrict link protocols.
- Render untrusted previews in a sandboxed `<iframe sandbox>` or a separate `WebContentsView` with no preload.
- Never `eval` or `executeJavaScript` strings that include untrusted data.

## 7. Protocols, files and permissions

- Prefer a custom protocol (`protocol.handle("app", ...)`) over `file://` for loading the app; validate the requested
  path stays inside the app bundle.
- Handle permission requests explicitly: `session.setPermissionRequestHandler` denying everything not needed
  (camera, microphone, geolocation, notifications...).
- Deep links (`app.setAsDefaultProtocolClient`): parse and validate parameters; never pass them to shell or file APIs
  unchecked.

## 8. Child processes and the agent

- Spawn with argument arrays (`spawn(cmd, args, { shell: false })`); never interpolate renderer-provided strings into
  a shell command.
- Environment passed to children excludes secrets they do not need.
- Long-running local servers bind to `127.0.0.1` with a random token.

## 9. Packaging, fuses and updates

- Flip Electron fuses at package time with `@electron/fuses` (electron-builder and Forge can do this):
  `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`,
  `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`, `EnableCookieEncryption: true`.
- Code-sign and notarize releases; auto-update only over HTTPS from a feed you control, with signature verification.
- Keep Electron current - each major version gets security fixes for a limited time and ships Chromium patches.
- Do not ship source maps or `.env` files inside the asar unintentionally.

## Quick grep list

```
nodeIntegration:\s*true
contextIsolation:\s*false
sandbox:\s*false
webSecurity:\s*false
exposeInMainWorld\([^)]*ipcRenderer
ipcMain\.(handle|on)\(
shell\.(openExternal|openPath)\(
executeJavaScript\(
setWindowOpenHandler|will-navigate
loadURL\(
dangerouslySetInnerHTML|innerHTML\s*=
```
