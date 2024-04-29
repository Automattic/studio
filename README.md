# Studio by WordPress.com

A desktop application for creating local WordPress environments, powered by WordPress.com and WordPress Playground.

![](https://raw.githubusercontent.com/Automattic/studio/trunk/demo.png)

## Getting started
Studio is open source and is available to download for free!

**Step 1: Download the App**

[Download Studio for macOS (Intel or Silicon)](https://developer.wordpress.com/studio/) for free today, or get on [the waiting list for the Windows version of Studio](https://developer.wordpress.com/studio-for-windows/).

**Step 2: Explore the Documentation**

[Visit the Studio documentation](https://developer.wordpress.com/docs/developer-tools/studio/) for detailed instructions, feature descriptions, and frequently asked questions.

**Step 3: Give Feedback**

We’d love to get your thoughts and feedback on your experience with Studio. If you have a question or suggestion, [reach out to our Happiness Engineers](https://developer.wordpress.com/contact/). Also, see the Contributing section for more information on how to get in touch with us.

## Contributing

Our mission is for Studio to be the fastest and simplest way for developers to build a WordPress site. We welcome all contributions in pursuit of this mission. Think fewer buttons, not more.

Feel free to [open an issue](https://github.com/Automattic/studio/issues/new/choose) to discuss your proposed improvement. Pull requests are welcome for bug fixes and enhancements. New features will need to go through our internal vetting process before they are accepted.

### Contributions etiquette

We are truly grateful for any PRs you open, and we assure you of our welcoming and respectful approach. We will review and consider all PRs, valuing the diverse contributions, but we don’t guarantee that all proposed changes will be merged into the core.

The most desirable PRs are:
- Bug fixes for existing features
- Enhancements that improve compatibility with different system versions, browsers, PHP or WP versions, WordPress plugins, or environments in general.

We recommend [adding an issue](https://github.com/Automattic/studio/issues/new/choose) for new features so we can review the plan before you start work on the PR.

### Start development

#### Initial setup

The project includes native dependencies which require Python and its `setuptools` module to build correctly.

If you manage packages with Homebrew you can do the following:

```bash
$ brew install python3 python-setuptools
```

#### Install dependencies, incrementally build, and run app

```bash
$ nvm use
$ npm install
$ npm start
```

The app automatically launches with the Chromium developer tools opened by default.

`src/index.ts` is the entry point for the main process.

`src/renderer.ts` is the entry point for the "renderer"—the code running in the Chromium window.

#### Code formatting

Code formatting has been set up to make merging PRs easier. It uses the same prettier/eslint mechanism as Calypso. See [JavaScript Coding Guidelines](https://github.com/Automattic/wp-calypso/blob/trunk/docs/coding-guidelines/javascript.md) for details on setting up your editor.

### Debugging

The renderer process can be debugged using the Chromium developer tools. To open the developer tools, press `Cmd+Option+I` on Mac or `Ctrl+Shift+I` on Windows.

The React tree in the renderer process can be debugged with the standalone [React Developer Tools](https://react.dev/learn/react-developer-tools#safari-and-other-browsers). To do this, start the the React Developer Tools and then start the app with the `REACT_DEV_TOOLS=true` flag set.

```bash
$ npx react-devtools
$ REACT_DEV_TOOLS=true npm start
```

The main process can be debugged using the Node.js inspector. To do this, run the app with the `--inspect-brk-electron` flag:

```bash
$ npm start -- --inspect-brk-electron
```

Then open `chrome://inspect` in a Chromium-based browser and click "inspect" next to the process you want to debug.

### Building Installers

Installers can currently be built on Mac (Intel or Apple Silicon) and Windows:

```bash
$ npm install
$ npm run make
```

### Localization

[See localization docs](./docs/localization.md)

### Versioning and Updates

[See versioning docs](./docs/versioning-and-updates.md)
