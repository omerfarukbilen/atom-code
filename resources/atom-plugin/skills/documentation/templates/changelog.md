# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
How to use (atom:documentation skill) - delete this comment in the real file:
- Add entries under [Unreleased] as part of each user-visible change.
- On release: rename [Unreleased] to [x.y.z] - YYYY-MM-DD, add a fresh empty [Unreleased], update the links at the bottom.
- Sections, in this order, only when non-empty: Added, Changed, Deprecated, Removed, Fixed, Security.
- Write for users: the effect of the change, not the implementation. Link issues/PRs.
- Breaking changes: prefix with **BREAKING:** and include migration steps.
- The example entries below show the expected style; replace them.
-->

## [Unreleased]

### Added

- CSV export for reports, including filters currently applied in the table view ([#512](https://github.com/OWNER/REPO/pull/512)).

### Changed

- **BREAKING:** `config.json` key `timeout` is now `requestTimeoutMs` and is measured in milliseconds.
  Rename the key and multiply existing values by 1000.

### Fixed

- Exports no longer drop rows that contain emoji in the customer name ([#498](https://github.com/OWNER/REPO/issues/498)).

## [1.4.0] - 2026-03-04

### Added

- Dark mode, following the operating system setting by default.

### Deprecated

- The `--legacy-auth` flag. It will be removed in 2.0; use `--auth=token` instead.

### Security

- Upgraded `example-http-lib` to 2.3.1 to address CVE-YYYY-NNNNN (request smuggling in chunked bodies).

## [1.3.2] - 2026-02-10

### Fixed

- Crash on startup when the workspace path contains non-ASCII characters.

[Unreleased]: https://github.com/OWNER/REPO/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/OWNER/REPO/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/OWNER/REPO/compare/v1.3.1...v1.3.2
