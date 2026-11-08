# AGENTS.md for GitHub GameOff 2026

Structure:

- `docs` for user-authored documentation - do not edit unless asked explicitly
  - `docs/design.md` for game design
  - `docs/architecture.md` for code architecture
- `prototypes` for standalone prototypes (ignore these unless prompted)

Preferences:

- Don't git add, commit or push unless asked explicitly to do so.
- Don't add descriptive top-of-file comments. Just a one-liner explaining what the file _is_.
- Don't add comments that state what is already obvious from the code. Reserve them for subtleties and helping structure long blocks of code.
- Prefer a concise local coding style; low-comment; typed functions.
- Avoid default args most of the time, I prefer being explicit.
- Avoid creating large numbers of files - I prefer fewer decent-sized components with tight interfaces between them.
- Prefer namespace-style imports e.g. `import * as physics from "./physics"`.
