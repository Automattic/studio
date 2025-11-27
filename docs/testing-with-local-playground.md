# Testing with Local Playground Packages

When developing features that require changes to WordPress Playground packages (`@wp-playground/*` or `@php-wasm/*`), you can test Studio with locally built Playground packages.

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

### 2. Update Studio's package.json

Replace the existing Playground dependencies with local file references. Find and update these entries in `package.json`:

```json
{
  "dependencies": {
    "@php-wasm/fs-journal": "file:../wordpress-playground/dist/packages/php-wasm/fs-journal",
    "@php-wasm/logger": "file:../wordpress-playground/dist/packages/php-wasm/logger",
    "@php-wasm/node": "file:../wordpress-playground/dist/packages/php-wasm/node",
    "@php-wasm/node-polyfills": "file:../wordpress-playground/dist/packages/php-wasm/node-polyfills",
    "@php-wasm/progress": "file:../wordpress-playground/dist/packages/php-wasm/progress",
    "@php-wasm/scopes": "file:../wordpress-playground/dist/packages/php-wasm/scopes",
    "@php-wasm/stream-compression": "file:../wordpress-playground/dist/packages/php-wasm/stream-compression",
    "@php-wasm/universal": "file:../wordpress-playground/dist/packages/php-wasm/universal",
    "@php-wasm/util": "file:../wordpress-playground/dist/packages/php-wasm/util",
    "@wp-playground/blueprints": "file:../wordpress-playground/dist/packages/playground/blueprints",
    "@wp-playground/cli": "file:../wordpress-playground/dist/packages/playground/cli",
    "@wp-playground/common": "file:../wordpress-playground/dist/packages/playground/common",
    "@wp-playground/wordpress": "file:../wordpress-playground/dist/packages/playground/wordpress"
  }
}
```

Note: Some of these packages may not exist in Studio's current `package.json` - add them as new entries.

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
npm install
```

### 5. Start Studio

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

2. Restart Studio (type `rs` in the terminal or restart `npm start`)

## Reverting to npm Packages

To go back to using the published npm packages:

1. Restore the original version numbers in `package.json` (use `git checkout package.json`)
2. Run `npm install`
