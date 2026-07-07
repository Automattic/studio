# Code Contributions

## Development

### Required Dependencies

Before you can build and run the app, you need to install the following dependencies:

- [Node.js](https://nodejs.org/) - required JavaScript runtime environment.
- [Python](https://www.python.org/) - required for building native dependencies.
- [setuptools](https://pypi.org/project/setuptools/) - required for building native dependencies.

Many project contributors rely upon [`nvm`](https://github.com/nvm-sh/nvm) and [Homebrew](https://brew.sh) to manage Node.js and Python installations respectively.

If you manage packages with Homebrew you can do the following:

```bash
brew install python3 python-setuptools
```

`nvm` commands referenced in the remaining documentation operate under the assumption that installed Node.js versions are managed with `nvm`. To use the correct Node.js version and install the project dependencies, run the following commands:

```bash
nvm use
npm install
```

Studio now uses npm workspaces. Run installs from the repo root (this also runs the nested CLI install required for packaging).

### Running the App

Once all required dependencies are installed, you can run the app with the following command:

```bash
npm start
```

This command starts the app in dev mode and opens it automatically, with the Chromium developer tools opened by default. Studio uses [Electron Forge](https://www.electronforge.io/) for running the app in dev mode, building, and packaging.

To start with a clean, isolated appdata file (useful for testing without affecting your real sites), use `npm run start:test` instead.

As with any Electron app, the code is split into two processes:

1. **Renderer Process** (reloads automatically):

   - All React components and UI code in `apps/studio/src/components/`, `apps/studio/src/modules/*/components/`
   - Hooks, stores, and utilities used by the UI (`apps/studio/src/hooks/`, `apps/studio/src/stores/`, etc.)
   - Any code that runs in the browser window context

2. **Main Process** (requires restart):
   - IPC handlers in `apps/studio/src/ipc-handlers.ts`
   - Electron main process code in `apps/studio/src/index.ts`
   - Node.js operations like file system access
   - PHP server management code

When editing main process code, you can either:

- Restart the app manually, or
- Type `rs` in the terminal where you ran `npm start` to restart the server

A good rule of thumb: if the code interacts with the operating system, file system, or PHP server, it's likely main process code and will need a restart to see changes.

> [!TIP]
> If you encounter `Error: Cannot find module 'appdmg'` error, ensure that `python-setuptools` are installed in your environment according to the previous steps.

### Running the CLI

The CLI is built separately from the Electron app. There are two commands to be aware of:

- `npm run cli:build` runs a one-time build.
- `npm run cli:watch` watches the source files and rebuilds automatically.

Both commands output a `apps/cli/dist/cli/main.mjs` file. To test the newly built CLI code, run the following command:

```
node apps/cli/dist/cli/main.mjs
```

### Project Structure

The project follows a modular architecture with both global and feature-specific code organization:

#### Global Directories

| Directory                     | Description                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `apps/cli/`                   | Root directory for CLI code                                                   |
| `apps/studio/src/`            | Root directory for Studio code                                                |
| `apps/studio/src/components/` | Reusable UI components used across the application                            |
| `apps/studio/src/hooks/`      | Global React hooks                                                            |
| `apps/studio/src/lib/`        | Utility functions and helper libraries                                        |
| `apps/studio/src/modules/`    | Feature-specific code                                                         |
| `apps/studio/src/stores/`     | Global state management (Redux stores)                                        |
| `apps/studio/src/api/`        | API interfaces and implementations                                            |
| `packages/common/`            | Shared code between CLI and Studio (constants, types, utility functions, etc) |
| `tools/`                      | Development-only tooling (not shipped): benchmarks, perf metrics, etc         |
| `tools/compare-perf/`         | Compare-perf tooling workspace                                                |
| `tools/eslint-plugin-studio/` | Custom ESLint rules                                                           |

#### Important Entry Points

| File                          | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `apps/cli/index.ts`           | The entry point for the CLI bundle                                          |
| `scripts/`                    | Scripts for building and testing the app                                    |
| `apps/studio/src/index.ts`    | The entry point for the main process                                        |
| `apps/studio/src/renderer.ts` | The entry point for the "renderer," the code running in the Chromium window |
| `vendor/wp-now`               | The modified `wp-now` source code                                           |

#### Feature Modules

Feature-specific code is organized in the `apps/studio/src/modules/` directory. Each module follows a consistent internal structure:

```
apps/studio/src/modules/
  ├── preview-site/          # Preview sites feature
  │   ├── components/        # Feature-specific components
  │   ├── hooks/             # Feature-specific hooks
  │   └── lib/               # Feature-specific utilities
  │
  ├── ai-agent/              # Studio Code AI agent feature
  │   └── ...
  │
  └── sidebar/               # Sites sidebar feature
      └── ...
```

Each feature module should be self-contained and include its own components, hooks, and utilities. This organization helps maintain separation of concerns and makes the codebase more maintainable.

### Code Formatting

Code formatting is set up to make merging pull requests easier. It uses the same Prettier/ESLint mechanism as Calypso, the code powering the WordPress.com dashboard. See [JavaScript Coding Guidelines](https://github.com/Automattic/wp-calypso/blob/trunk/docs/coding-guidelines/javascript.md) for guidance on setting up your editor for code formatting.

### CLI Development

The CLI relies upon a separate instance of the app to run. When developing the CLI, the CLI can be invoked with the following steps:

- Run `npm start` to launch the first instance of the app.
- Within `apps/studio/forge.config.ts`, change the `WebpackPlugin` ports used for the second instance:
  - Set the development `port` to `3457`.
  - Add a `loggerPort` property set to `9001`.
- Run `npm start -- -- --cli"=<CLI-COMMAND>"` in separate terminal session.

## Testing

### Unit Tests

Automated unit tests can be run with the following command:

```bash
npm run test
```

Or to run tests in "watch" mode:

```bash
npm run test:watch
```

### End-to-End Tests

Automated end-to-end (E2E) tests are also available. To run them, clean the `out/` directory and build the fresh app binary:

```bash
npm run make
```

Then run tests:

```bash
npm run e2e
```

### CI: E2E and Performance Tests on Pull Requests

E2E and performance tests run automatically on Buildkite for non-draft PRs. Draft PRs skip these tests to save CI resources (see [`.buildkite/pipeline.yml`](../.buildkite/pipeline.yml)).

When you mark a draft PR as ready for review, Buildkite does **not** automatically re-trigger a build. You need to push a new commit to start the E2E and performance test runs. If your branch is already up to date, an empty commit works:

```bash
git commit --allow-empty -m "Trigger CI"
git push
```

## Debugging

The renderer process can be debugged using the Chromium developer tools. To open the developer tools, press <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on Mac or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> on Windows. You can also use the [React Developer Tools](https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi) and [Redux DevTools](https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd) to debug the renderer process.

The main process can be debugged using the Node.js inspector. To do this, run the app with the `--inspect-brk` and `--sourcemap` flags:

```bash
npm start -- --inspect-brk --sourcemap
```

Then open `chrome://inspect` in a Chromium-based browser and click "inspect" next to the process you want to debug.

## Building Installers

Once all required dependencies are installed, you can build installers for the app.
Installers can be built on Mac (Intel or Apple Silicon), Windows (x64 or ARM64), and Linux (x64 or ARM64) using the following commands:

```bash
npm install
npm run make
```

After the build process completes, you can find the executables in the `out/` directory.

Linux has additional source-build steps and platform-specific troubleshooting — see the [Linux notes](./linux.md).

## Localization

See [Localization](./localization.md) documentation.

## Versioning and Updates

See [Versioning and Updates](./versioning-and-updates.md) documentation.

## Design Docs

- [Custom Domains and SSL](./design-docs/custom-domains-and-ssl.md)
- [What's New modal](./design-docs/whats-new-modal.md)
- [Sync](./design-docs/sync.md)
