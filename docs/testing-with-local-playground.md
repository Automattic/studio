# Testing with Local Playground Packages

When developing features that require changes to WordPress Playground packages (`@wp-playground/*` or `@php-wasm/*`), you can test Studio's CLI with locally built Playground packages.

**Note:** The desktop app does not directly use PHP-WASM packages - only the CLI does. These instructions are for testing CLI functionality.

## Prerequisites

Clone the WordPress Playground repository alongside the Studio repository:

```
Code/
├── studio/
└── wordpress-playground/
```

**Important:** Make sure to initialize git submodules:

```bash
cd /path/to/wordpress-playground
git submodule update --init --recursive
```

## Setup Steps

### 1. Build Playground packages

```bash
cd /path/to/wordpress-playground
npm install
npm run build
```

### 2. Update CLI's package.json

Replace the existing Playground dependencies in `apps/cli/package.json` with local file references:

```json
{
  "dependencies": {
    "@php-wasm/universal": "file:../../wordpress-playground/dist/packages/php-wasm/universal",
    "@wp-playground/blueprints": "file:../../wordpress-playground/dist/packages/playground/blueprints",
    "@wp-playground/cli": "file:../../wordpress-playground/dist/packages/playground/cli",
    "@wp-playground/common": "file:../../wordpress-playground/dist/packages/playground/common",
    "@wp-playground/storage": "file:../../wordpress-playground/dist/packages/playground/storage"
  }
}
```

### 3. Update Playground's node_modules symlinks

Playground's built packages import other packages from `node_modules`. By default, these point to source directories, but we need them to point to the built `dist/` packages.

Run this from the wordpress-playground root:

```bash
cd /path/to/wordpress-playground

for pkg in node-polyfills logger util progress fs-journal stream-compression scopes universal node web web-service-worker cli xdebug-bridge; do
  if [ -d "dist/packages/php-wasm/$pkg" ]; then
    rm -rf "node_modules/@php-wasm/$pkg" && ln -s "../../dist/packages/php-wasm/$pkg" "node_modules/@php-wasm/$pkg"
  fi
done

for pkg in cli blueprints wordpress common storage client remote components wordpress-builds; do
  if [ -d "dist/packages/playground/$pkg" ]; then
    rm -rf "node_modules/@wp-playground/$pkg" && ln -s "../../dist/packages/playground/$pkg" "node_modules/@wp-playground/$pkg"
  fi
done
```

### 4. Install dependencies in Studio

```bash
cd /path/to/studio
rm -rf apps/cli/node_modules
npm --prefix apps/cli install
npm install
```

### 5. Build and test the CLI

```bash
npm run cli:build
node apps/cli/dist/cli/main.js site create --name test-site
```

### 6. Start Studio (optional)

If you want to test the full desktop app with CLI changes:

```bash
npm start
```

## Development Workflow

After making changes to Playground:

1. Rebuild the changed package(s):
   ```bash
   cd /path/to/wordpress-playground
   npx nx build playground-cli  # or other package name
   ```

2. Rebuild the CLI:
   ```bash
   cd /path/to/studio
   npm run cli:build
   ```

3. If testing with the desktop app, restart `npm start`

## Reverting to npm Packages

To go back to using the published npm packages:

1. Restore `apps/cli/package.json`:
   ```bash
   git checkout apps/cli/package.json
   ```
2. Reinstall CLI dependencies:
   ```bash
   rm -rf apps/cli/node_modules
   npm --prefix apps/cli install
   ```
3. In the Playground repo, restore the original `node_modules` symlinks:
   ```bash
   cd /path/to/wordpress-playground
   npm install
   ```
