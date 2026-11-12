# @studio/blueprints

WordPress Blueprints in Studio: the Blueprint Library, checking a Blueprint, reading and changing what it asks for, and opening one from wherever it comes from. The CLI, the Desktop app, the `studio ui` server, `apps/ui` and Studio on the web all go through it, so a Blueprint is resolved the same way everywhere. It imports no other workspace package.

```
index.ts      the browser-safe entry
library.ts    fetchLibraryBlueprints, LibraryBlueprint
validate.ts   validateBlueprint, Blueprint
details.ts    inspectBlueprint, customizeBlueprint, BlueprintDetails
node.ts       openBlueprint, openBlueprintFile, the Node entry
```

## Two entries

- **`@studio/blueprints`** runs in Node and in the page. `apps/ui` and Studio on the web import only this.
- **`@studio/blueprints/node`** reads and writes files. The CLI, the Desktop main process and `apps/local` import it.

```ts
import { fetchLibraryBlueprints, inspectBlueprint, validateBlueprint } from '@studio/blueprints';
import { openBlueprint, openBlueprintFile } from '@studio/blueprints/node';
```

## The Library

`fetchLibraryBlueprints( { locale } )` lists the Blueprint Library from WordPress.com, in the user's language. Each `LibraryBlueprint` has what a gallery shows (`slug`, `title`, `excerpt`, `image`, `playgroundUrl`), the Blueprint itself, and `bundleUrl` when its steps use files that ship beside it in a zip. The `blueprint` field is only loosely checked, so open the entry before running it.

## Checking and reading a Blueprint

`validateBlueprint( data )` checks data against Playground's Blueprint v1 schema and returns it as a `Blueprint`, or throws a translated message naming the first problem (`"name" is not a valid Blueprint property at /steps/2`). It checks the shape only: whether a plugin exists or a bundled file is in the zip shows when the Blueprint runs.

`inspectBlueprint( blueprint )` reports what a Blueprint asks for, in its own terms: `title` and `description` from `meta`, the preferred `phpVersion` and `wpVersion` as written, `siteTitle` (`blogname`), `siteUrl` (the `defineSiteUrl` step), `login`, and `multisite`. Studio decides what to do with them, such as whether it supports that PHP version.

`customizeBlueprint( blueprint, changes )` returns a copy with those details changed. It only changes what the Blueprint already sets, so a Blueprint never gains steps or options it didn't ask for. `studio create` uses it so the site's name and domain win over the Blueprint's.

## Opening a Blueprint

`openBlueprint( source, { locale } )` turns a source into a checked Blueprint and its `blueprint.json` on disk, with the files its steps use beside it, which is what the Blueprint runner needs. A string is tried in this order:

1. A URL: a JSON Blueprint or a zip bundle, downloaded into a temp folder.
2. An existing path: a `.json` file or a folder holding `blueprint.json` (read in place), or a zip bundle (unpacked into a temp folder, with `blueprint.json` at its root or inside one enclosing folder).
3. A Library slug: the entry's bundle, or its Blueprint written into a temp folder.

A `LibraryBlueprint` opens the same way as its slug. Open it with `await using`: whatever it unpacked is removed when the block ends, even on an error, so no temp folder outlives the caller and no caller deletes paths itself.

```ts
await using opened = await openBlueprint( 'apparel', { locale } );
await runBlueprint( site, { blueprint: opened.blueprint, blueprintUri: opened.path } );
```

`openBlueprintFile( path )` opens only a local `.json` file, folder or zip bundle, and never reaches the network. Use it for paths a user picked or uploaded, which a server must not turn into requests.

To show a Blueprint before creating a site from it, open it, read `opened.blueprint` and let it close; creating the site opens the source again.

## Rules

- **No workspace dependencies.** Locale and anything else Studio-specific come in as parameters.
- **Playground for types and the schema only.** `@wp-playground/blueprints` is an exact-pinned devDependency: import only its types, and its schema validator, `@wp-playground/blueprints/blueprint-schema-validator`, which every app that bundles this package maps to the file in its Vite and Vitest config.
- **Translated messages.** The folder is in the string-extraction glob in `fastlane/Fastfile`, so its `__()` strings reach translators.
