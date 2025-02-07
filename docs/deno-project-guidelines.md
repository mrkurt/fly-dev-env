# Managing Dependencies in Deno: Best Practices (2024)

## Project Structure
The recommended structure for a Deno project is:

```
my_project/
├── deno.json        # Deno configuration (permissions, import maps, tasks)
├── mod.ts           # Main entry point (exports public API)
├── lib/            # Core library code (reusable modules)
│   ├── types.ts    # Shared type definitions
│   └── utils.ts    # Utility functions
├── commands/       # CLI command implementations (if a CLI)
│   └── cmd.ts     # Command module
└── tests/         # Test directory
    ├── fixtures/  # Test data/resources
    └── lib/       # Tests matching lib/ structure
```

Key points about this structure:
- Keep core logic in `lib/` - this is the Deno convention for reusable code
- Use `mod.ts` as the main entry point - this is the Deno equivalent of index.js
- Place CLI-specific code in `commands/` if building a CLI
- Mirror the lib structure in tests for easy correlation
- Use import maps in deno.json to create clean import paths

## Use `deno.json` and Import Maps for Dependencies  
Leverage Deno's config file (`deno.json`) to centralize and manage your module imports. Deno 2 introduced built-in support for **import maps** via `deno.json`, replacing the old practice of manually tracking URLs (e.g. in a `deps.ts` file).

The recommended workflow is to use the `deno add` command to add dependencies to your project. This command will fetch the module and update your `deno.json` automatically, listing the package under an **`imports`** map with its URL and version.

Example `deno.json`:
```json
{
  "tasks": {
    "test": "deno test --allow-run",
    "check": "deno check **/*.ts",
    "fmt": "deno fmt"
  },
  "imports": {
    "$lib/": "./lib/",
    "$commands/": "./commands/",
    "$tests/": "./tests/",
    "@std/path": "jsr:@std/path@^1.0.8",
    "@std/fs": "jsr:@std/fs@^1.0.11"
  }
}
```

## Pin Dependencies to Specific Versions  
Always **specify an explicit version** for each dependency you import. In Deno, URLs without a version tag (e.g. importing from an address like `.../x/mod.ts` with no `@v1.2.3`) are not recommended. Unversioned or floating imports make your build non-deterministic and can break when the upstream updates.

## Use Standard Library Modules via `@std/…` Imports  
Deno's Standard Library is now **stable** and organized into versioned modules (packages) such as `@std/path`, `@std/fs`, `@std/http`, etc. Rather than deep-linking to a specific file on deno.land, the best practice is to import std modules via these package names.

Example:
```ts
import { copy } from "@std/fs";
import { join } from "@std/path";
```

## Read Documentation and Inspect Packages Before Use  
Before adopting a third-party package, make it a habit to **read its documentation and inspect its details** using Deno's tools. The Deno CLI provides commands like `deno info` and `deno doc` specifically to help developers evaluate modules fetched from the web.

For any new dependency, you should:
- Check the documentation with `deno doc <url>`
- Inspect the dependency tree with `deno info <url>`
- Review the latest version on JSR or deno.land/x
- Verify compatibility with your Deno version 