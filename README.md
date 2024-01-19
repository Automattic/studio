# Local Environment

A desktop app experience for building a block themes.

## Deving

```bash
$ nvm use
$ npm install
$ npm start
```

The app auto-opens and the Chromium developer tools are opened by default.

`src/index.ts` is the entrypoint for the main process.

`src/renderer.ts` is the entrypoint for the "renderer"—the code running in the Chromium window.

Code formatting has been set up just to make merging PRs easier. It uses the same prettier/eslint mechanism as Calypso, see p4TIVU-9Lo-p2 for details on setting up your editor.

## Building Installers

```bash```
$ npm run make
```
