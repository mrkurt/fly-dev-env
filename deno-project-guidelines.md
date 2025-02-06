Understood. I'll find the current best practices for managing dependencies in Deno, specifically focusing on:
- Using `deno.json` for dependency management.
- Explicitly specifying the most recent versions for each package.
- Ensuring all `std` packages are referenced as `@std/pkg` without deeper references.
- Requiring developers or an LLM to read package documentation using the Deno CLI before using a third-party package.

Once I have the research, I'll create a structured document explaining project layout, dependency management, and best practices that can be given to a developer or LLM.

# Managing Dependencies in Deno: Best Practices (2024)

## Use `deno.json` and Import Maps for Dependencies  
Leverage Deno’s config file (`deno.json`) to centralize and manage your module imports. Deno 2 introduced built-in support for **import maps** via `deno.json`, replacing the old practice of manually tracking URLs (e.g. in a `deps.ts` file) ([Survey Results and Roadmap](https://deno.com/blog/2024-survey-results-and-roadmap#:~:text=two%20modules%20but%20of%20different,package.json))  The recommended workflow is to use the `deno add` command to add dependencies to your project. This command will fetch the module and update your `deno.json` automatically, listing the package under an **`imports`** map with its URL and version ([Modules and dependencies](https://docs.deno.com/runtime/fundamentals/modules/#:~:text=The%20installation%20process%20is%20made,deno.json))  This approach keeps your code imports clean (you can use bare specifiers instead of long URLs) and ensures all dependency versions are recorded in one place for reproducibility ([Dependency Management in Deno](https://www.kevincunningham.co.uk/posts/intro-to-jsr#:~:text=,GitHub%20raw%20imports%20unless%20unavoidable))  For example: 

- Running `deno add jsr:@std/path npm:chalk` will create or update `deno.json` with an import map entry for the standard library path module and the Chalk npm package ([Introducing your new JavaScript package manager: Deno](https://deno.com/blog/your-new-js-package-manager#:~:text=Use%20deno%20add%20to%20add,file))  If no config existed, Deno will generate one with the appropriate fields.  
- After adding, your `deno.json` might include:  
  ```json
  "imports": {
    "@std/path": "jsr:@std/path@^1.0.8",
    "chalk": "npm:chalk@5.3.0"
  }
  ```  
  Now in your code you can simply `import { join } from "@std/path";` or `import chalk from "chalk";` without manually typing the URL ([Deno 2 Released, Focuses on Interoperability with Legacy JavaScript Infrastructure and Use at Scale - InfoQ](https://www.infoq.com/news/2024/12/deno-2-released/#:~:text=Developers%20can%20also%20leverage%20import,specifier%20for%20their%20npm%20package))  ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=%7B%20,%7D))   

Using `deno.json` + import maps in this way simplifies dependency management and avoids scattering versioned URLs throughout your codebase. It’s a **Deno community best practice** to explicitly track dependencies in the config for clarity and lock them to known versions ([Dependency Management in Deno](https://www.kevincunningham.co.uk/posts/intro-to-jsr#:~:text=,GitHub%20raw%20imports%20unless%20unavoidable)) 

## Pin Dependencies to Specific Versions  
Always **specify an explicit version** for each dependency you import. In Deno, URLs without a version tag (e.g. importing from an address like `.../x/mod.ts` with no `@v1.2.3`) are not recommended. Unversioned or floating imports make your build non-deterministic and can break when the upstream updates – *“avoid unversioned URLs (`@version` should always be included for stability)”* ([Dependency Management in Deno](https://www.kevincunningham.co.uk/posts/intro-to-jsr#:~:text=%E2%9D%8C%20Avoid%20importing%20from%20raw,term%20reliability))  Instead, pin to the latest stable release (or the exact version you need) when adding a dependency. The `deno add` command by default pulls the **most recent version** of a package and records it (using a semver range like `^x.y.z` by default) in your `deno.json` ([Modules and dependencies](https://docs.deno.com/runtime/fundamentals/modules/#:~:text=The%20installation%20process%20is%20made,deno.json))  You can also request a specific version by appending it (for example, `deno add jsr:@luca/cases@1.0.0` to get exactly v1.0.0) ([Modules and dependencies](https://docs.deno.com/runtime/fundamentals/modules/#:~:text=You%20can%20also%20specify%20an,exact%20version))  

By pinning versions, you ensure reproducible builds. It’s wise to periodically update your dependencies to pick up fixes and improvements once you’ve vetted them. Deno provides a tool for this: `deno outdated` scans your `deno.json` (or `package.json`) and reports which dependencies have newer releases available ([deno outdated](https://docs.deno.com/runtime/reference/cli/outdated/#:~:text=Checking%20for%20outdated%20dependencies%20Jump,to%20heading))  You can even have it automatically update them (respecting semver rules) with flags like `--update` ([deno outdated](https://docs.deno.com/runtime/reference/cli/outdated/#:~:text=Update%20dependencies%20to%20latest%20semver,compatible%20versions))  Incorporating these updates regularly (after testing compatibility) keeps your project using the most recent safe versions of each package.

## Use Standard Library Modules via `@std/…` Imports  
Deno’s Standard Library is now **stable** and organized into versioned modules (packages) such as `@std/path`, `@std/fs`, `@std/http`, etc. Rather than deep-linking to a specific file on deno.land, the best practice is to import std modules via these package names. The entire standard lib is hosted on Deno’s official registry (JSR) and each module has its own semantic versioning ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=Each%20package%20of%20the%20standard,releases%20from%20affecting%20your%20code))  ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=The%20standard%20library%20is%20hosted,here%20are%20a%20few%20examples))  This means you can manage std dependencies just like third-party ones. Use `deno add` with the `jsr:@std/<module>` specifier to add a std library package to your import map. For example: 

- `deno add jsr:@std/fs` will update your config to include `"@std/fs": "jsr:@std/fs@^1.0.2"` (assuming 1.0.2 is the latest) ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=deno%20add%20jsr%3A%40std%2Ffs%20jsr%3A%40std%2Fpath))   
- In your code, you can then import from `@std/fs` directly:  
  ```ts
  import { copy } from "@std/fs";
  import { join } from "@std/path";
  ```  
  This pulls in the file-system utilities and path utilities from Deno’s std lib at the pinned versions ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=%7B%20,%7D))  ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=You%20can%20then%20import%20these,packages%20in%20your%20source%20code))  No need to reference a deeper path like `std@0.x.x/fs/copy.ts` – the `@std/fs` package exposes its functionality in a stable interface.  

Using the `@std/` alias ensures you’re always using the intended public API of the standard library. It avoids relying on internal file paths that might change, since each module’s entry point (e.g. `mod.ts`) is what `@std/name` resolves to. The Deno team has audited these std modules for reliability and compatibility across Deno versions ([Standard Library](https://docs.deno.com/runtime/fundamentals/standard_library/#:~:text=Deno%20provides%20a%20standard%20library,Deno%2C%20ensuring%20consistency%20and%20reliability))  so you can use them confidently. Always prefer the official std package import (e.g. `@std/path`) over hard-coding URLs into submodules.

## Read Documentation and Inspect Packages Before Use  
Before adopting a third-party package, make it a habit to **read its documentation and inspect its details** using Deno’s tools. The Deno CLI provides commands like `deno info` and `deno doc` specifically to help developers evaluate modules fetched from the web ([Third Party Modules | Deno](https://deno.land/x#:~:text=To%20make%20it%20easier%20to,deno%20info%20and%20deno%20doc))  For any new dependency, you should: 

- **Check the documentation** – Use `deno doc <url>` (or `deno doc` with the import specifier if it’s in your import map) to review the module’s functions, classes, and usage examples right in your terminal. Deno’s registry auto-generates docs from JSDoc comments, which you can also view on the web (for example on **deno.land/x** or **jsr.io** pages) ([Deno in 2024](https://deno.com/blog/deno-in-2024#:~:text=,Read%20more))  Reading the docs ensures you know how to use the API correctly and reveals any caveats or initialization required.  
- **Inspect the dependency tree** – Use `deno info <url>` to see what other modules a package pulls in. This can alert you to large or possibly outdated sub-dependencies, and it helps you understand the package’s footprint and if it might require certain permissions. Deno’s info and doc tools exist to make consuming third party modules safer and easier ([Third Party Modules | Deno](https://deno.land/x#:~:text=To%20make%20it%20easier%20to,deno%20info%20and%20deno%20doc))   

By reviewing a module’s documentation and metadata first, developers (or even an assisting LLM) can make informed decisions. You’ll catch whether the module needs certain permissions (for example, a database client might require `--allow-net`) and learn the recommended usage from the authors before writing code. In essence, **don’t blindly import** a URL – take advantage of Deno’s tooling to *know* your dependencies. This extra step, encouraged in the Deno community, leads to better-informed usage of third-party packages and more secure, reliable codebases.

