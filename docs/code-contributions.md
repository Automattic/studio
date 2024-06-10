# Code Contributions

### Start development

#### Initial setup

The project includes native dependencies which require Python and its `setuptools` module to build correctly.

If you manage packages with Homebrew you can do the following:

```bash
brew install python3 python-setuptools
```

#### Install dependencies, incrementally build, and run app

```bash
nvm use
npm install
npm start
```

The app automatically launches with the Chromium developer tools opened by default.

`src/index.ts` is the entry point for the main process.

`src/renderer.ts` is the entry point for the "renderer"—the code running in the Chromium window.

#### Code formatting

Code formatting has been set up to make merging PRs easier. It uses the same prettier/eslint mechanism as Calypso. See [JavaScript Coding Guidelines](https://github.com/Automattic/wp-calypso/blob/trunk/docs/coding-guidelines/javascript.md) for details on setting up your editor.

### Testing

#### Unit tests

You can run tests with the following command:

```bash
npm run test
```

#### E2E tests

There are also E2E tests available. To run them, clean the `out/` directory and build the fresh app binary:

```bash
npm run make
```

Then run tests:

```bash
npm run e2e
```

### Debugging

The renderer process can be debugged using the Chromium developer tools. To open the developer tools, press `Cmd+Option+I` on Mac or `Ctrl+Shift+I` on Windows.

The React tree in the renderer process can be debugged with the standalone [React Developer Tools](https://react.dev/learn/react-developer-tools#safari-and-other-browsers). To do this, start the the React Developer Tools and then start the app with the `REACT_DEV_TOOLS=true` flag set.

```bash
npx react-devtools
REACT_DEV_TOOLS=true npm start
```

The main process can be debugged using the Node.js inspector. To do this, run the app with the `--inspect-brk-electron` flag:

```bash
npm start -- --inspect-brk-electron
```

Then open `chrome://inspect` in a Chromium-based browser and click "inspect" next to the process you want to debug.

### Building Installers

Installers can currently be built on Mac (Intel or Apple Silicon) and Windows:

```bash
npm install
npm run make
```

### Localization

[See localization docs](./docs/localization.md)

### Versioning and Updates

[See versioning docs](./docs/versioning-and-updates.md)
