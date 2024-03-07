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

[See localization docs](./docs/localization.md)

## Versioning and Updates

[See versioning docs](./docs/versioning-and-updates.md)

## [Linux] Authentication setup for local development
In order for the authentication to work on Linux, you need to follow the next steps:
- Run `npm run make` from the root of the project
- Create a new `.desktop` file in `~/.local/share/applications/` with the following content:
```
[Desktop Entry]
Name=Studio By WordPress.com dev
Comment=Studio By WordPress.com dev
Exec=<path_of_project>/out/Studio-linux-x64/studio %U
Type=Application
Terminal=false
MimeType=x-scheme-handler/wpcom-local-dev;
Categories=Development;
```

- Run `update-desktop-database ~/.local/share/applications/` to update the desktop database
- Ensure that there is an new entry in `~/.config/mimeapps.list` for `x-scheme-handler/wpcom-local-dev` protocol.
