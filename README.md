# Studio by WordPress.com

A desktop application for creating local WordPress environments powered by WordPress Playground.

## Development

```bash
$ nvm use
$ npm install
$ npm start
```

The app automatically launches with the Chromium developer tools opened by default.

`src/index.ts` is the entry point for the main process.

`src/renderer.ts` is the entry point for the "renderer"—the code running in the Chromium window.

Code formatting has been set up to make merging PRs easier. It uses the same prettier/eslint mechanism as Calypso, see p4TIVU-9Lo-p2 for details on setting up your editor.

## Building Installers

Installers can currently be built on Mac (Intel or Apple Silicon) and Windows:

```bash
$ npm install
$ npm run make
```

## Localization

[See localisation docs](./docs/localization.md)
