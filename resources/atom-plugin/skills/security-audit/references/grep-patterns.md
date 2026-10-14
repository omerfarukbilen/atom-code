# Search patterns for security review

Use these with the Grep tool (ripgrep regex syntax; set `-i` where case varies, and restrict with `glob` or `type`).
They find **candidates**, not vulnerabilities: every hit must be traced to an attacker-controlled source and a
reachable path before it becomes a finding. Exclude noise with globs such as `!**/node_modules/**`,
`!**/dist/**`, `!**/*.min.js`, `!**/vendor/**`.

## Entry points

- **Express/Koa/Fastify/Hono routes**: `\.(get|post|put|patch|delete|all|use)\(\s*['"\x60]/`
- **Next.js route handlers / server actions**: `export (async )?function (GET|POST|PUT|PATCH|DELETE)\b` and `['"]use server['"]`
- **Flask / FastAPI**: `@(app|router|bp|blueprint)\.(route|get|post|put|patch|delete)\(`
- **Django**: `path\(|re_path\(` in `urls.py`; `@csrf_exempt`
- **Go net/http, chi, gin, echo**: `HandleFunc\(|\.Handle\(|\.(GET|POST|PUT|PATCH|DELETE)\(`
- **Rust axum / actix**: `\.route\(|#\[(get|post|put|patch|delete)\(`
- **GraphQL resolvers**: `Mutation:|Query:|@Resolver|@Mutation\(`
- **Electron IPC**: `ipcMain\.(handle|on|once)\(` and `contextBridge\.exposeInMainWorld`
- **Webhooks**: `webhook` (`-i`)
- **CLI / env input**: `process\.argv|process\.env\.|os\.environ|sys\.argv|os\.Getenv|std::env::`
- **File uploads**: `multer|formidable|busboy|UploadFile|request\.files|FormFile\(`

## Injection sinks

- **SQL built with strings (JS/TS)**: `(query|execute|raw|\$queryRawUnsafe|\$executeRawUnsafe)\(\s*\x60[^\x60]*\$\{`
- **SQL built with strings (Python)**: `execute\(\s*f['"]|execute\([^)]*%\s*\(|execute\([^)]*\.format\(`
- **SQL built with strings (Go)**: `(Query|Exec|QueryRow)(Context)?\([^)]*(fmt\.Sprintf|\+)`
- **ORM raw fragments**: `sequelize\.literal|knex\.raw|\.raw\(|text\(f['"]|RawSQL\(|\.extra\(|whereRaw\(`
- **NoSQL operators from input**: `find(One)?\(\s*req\.(body|query)|\$where`
- **Shell (Node)**: `child_process|exec\(|execSync\(|spawn\([^)]*shell:\s*true`
- **Shell (Python)**: `os\.system\(|os\.popen\(|subprocess\.[a-z_]+\([^)]*shell\s*=\s*True`
- **Shell (Go / Rust)**: `exec\.Command\(\s*"(sh|bash|cmd)"|Command::new\(\s*"(sh|bash|cmd)"`
- **Code evaluation**: `\beval\(|new Function\(|setTimeout\(\s*['"\x60]|vm\.run|\bexec\(\s*(compile|input)`
- **Template compilation**: `render_template_string\(|Template\([^)]*request|Handlebars\.compile\(|_\.template\(|ejs\.render\(`
- **Path from input**: `(readFile|writeFile|createReadStream|unlink|rm|open|sendFile|send_file)\w*\([^)]*req\.`
- **Path joins (review containment)**: `path\.(join|resolve)\(|os\.path\.join\(|filepath\.Join\(`
- **Archive extraction**: `extractall\(|adm-zip|unzipper|tar\.x\(|archive/zip`
- **Regex from input**: `new RegExp\(\s*(req|input|params|query|user)`
- **XXE-prone XML parsing**: `etree\.parse|xml\.dom\.minidom|DocumentBuilderFactory|libxmljs|noent:\s*true`

## XSS and client-side

- **Raw HTML insertion**: `dangerouslySetInnerHTML|v-html|\[innerHTML\]|\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write`
- **Unsafe URLs**: `href=\{|:href=|window\.location\s*=|location\.href\s*=` (check for `javascript:`)
- **Markdown with HTML**: `html:\s*true|allowDangerousHtml|rehype-raw|sanitize:\s*false`
- **postMessage**: `addEventListener\(\s*['"]message['"]|postMessage\([^)]*['"]\*['"]`
- **Tokens in web storage**: `localStorage\.setItem\([^)]*(token|jwt|secret|key)` (`-i`)

## Authentication and authorization

- **Lookup by ID (check tenant scoping)**: `findUnique\(|findById\(|findByPk\(|get_object_or_404\(|\.get\(id=|WHERE id = `
- **Mass assignment**: `Object\.assign\([^,]+,\s*req\.body|\.\.\.req\.body|\*\*request\.(json|data)|\.update\(req\.body`
- **JWT misuse**: `jwt\.decode\(|algorithms:\s*\[[^\]]*none|verify=False|verify_signature['"]?:\s*False`
- **Disabled CSRF**: `csrf_exempt|csrf:\s*false|disable\(\)\s*.*csrf` (`-i`)
- **Permissive CORS**: `Access-Control-Allow-Origin['"]?,\s*['"]\*|origin:\s*(true|\*|['"]\*['"])|credentials:\s*true`
- **Cookies**: `httpOnly:\s*false|secure:\s*false|sameSite:\s*['"]none['"]` (`-i`)

## Secrets

- **Generic assignments**: `(api[_-]?key|secret|passw(or)?d|token|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]` (`-i`)
- **Private keys**: `-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----`
- **AWS access key ID**: `\b(AKIA|ASIA)[0-9A-Z]{16}\b`
- **GitHub tokens**: `\bgh[pousr]_[A-Za-z0-9]{36,}\b|github_pat_[A-Za-z0-9_]{60,}`
- **Slack tokens**: `\bxox[baprs]-[A-Za-z0-9-]{10,}`
- **Stripe live keys**: `\b(sk|rk)_live_[A-Za-z0-9]{16,}`
- **Google API keys**: `\bAIza[0-9A-Za-z_\-]{35}\b`
- **Anthropic / OpenAI style keys**: `\bsk-ant-[A-Za-z0-9_\-]{20,}|\bsk-(proj-)?[A-Za-z0-9_\-]{20,}`
- **Connection strings with passwords**: `[a-z]+://[^\s:/@]+:[^\s@/]+@`
- **Env files tracked by Git**: Glob `**/.env*`, then `git ls-files | grep -E '(^|/)\.env'` via Bash

Show only a short prefix of any secret you find in reports.

## Crypto and randomness

- **Weak randomness for security**: `Math\.random\(|random\.(random|randint|choice)\(|math/rand` near token/id/password code
- **Weak hashes for passwords**: `(md5|sha1|sha256)\(` near `password` (`-i`); `createHash\(['"](md5|sha1)['"]`
- **Insecure cipher modes**: `ECB|createCipher\(|DES|RC4|AES\.new\([^)]*MODE_ECB`
- **TLS verification off**: `rejectUnauthorized:\s*false|verify\s*=\s*False|InsecureSkipVerify:\s*true|NODE_TLS_REJECT_UNAUTHORIZED`
- **Non-constant-time compare**: `(signature|token|hmac|digest|secret)\w*\s*(===|==|!=)` (`-i`)

## Deserialization and prototype pollution

- **Python**: `pickle\.loads?\(|yaml\.load\(|yaml\.unsafe_load|marshal\.loads|shelve\.open|jsonpickle`
- **Java / .NET / PHP**: `ObjectInputStream|readObject\(|BinaryFormatter|unserialize\(`
- **Node**: `node-serialize|serialize-javascript.*unsafe|funcster`
- **Prototype pollution**: `__proto__|constructor\[|merge\(|deepmerge|_\.set\(|lodash\.set|setWith\(`

## SSRF candidates

- **Outbound HTTP with variable URLs**: `fetch\(\s*[a-zA-Z_]|axios\.(get|post|request)\(\s*[a-zA-Z_]|got\(|requests\.(get|post|request)\(|httpx\.|http\.(Get|Post)\(|reqwest::`
- **Headless browsers / renderers**: `puppeteer|playwright|page\.goto\(|wkhtmltopdf`
- **Image/URL import features**: `(image|avatar|import|preview|webhook)_?url` (`-i`)

## Electron

See electron-hardening.md "Quick grep list".
