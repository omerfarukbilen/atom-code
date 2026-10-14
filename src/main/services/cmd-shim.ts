/**
 * npm `.cmd` shim parsing (pure, unit tested). See resolveCmdShimTarget in claude-binary.ts.
 */

/**
 * The program an npm/cmd-shim `.cmd` file runs, relative to the shim's folder (e.g.
 * `node_modules\@anthropic-ai\claude-code\cli.js`), or null when the text is not such a shim.
 * cmd-shim writes it as `"%dp0%\relative\path"` (older versions: `"%~dp0\relative\path"`) and may
 * mention `node.exe` first (`IF EXIST "%dp0%\node.exe"`): the program is the last script/exe match.
 */
export function parseCmdShimTarget(text: string): string | null {
  const re = /"%~?dp0%?\\?([^"%]+?\.(?:c?js|mjs|exe))"/gi
  let target: string | null = null
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (/^node\.exe$/i.test(m[1])) continue
    target = m[1]
  }
  return target
}
