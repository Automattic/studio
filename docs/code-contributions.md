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

### Running the App

Once all required dependencies are installed, you can run the app with the following command:

```bash
npm install
npm start
```

The app automatically launches with the Chromium developer tools opened by default. Changes to the "renderer" process code will automatically reload the app, changes to the main process code require a manual server restart or [typing `rs`](https://www.electronforge.io/cli#start) into the same terminal where the server was started.

### Project Structure

The following represents notable pieces of project structure:

- `scripts/` - scripts for building and testing the app.
- `src/` - the source code for the app.
- `src/index.ts` - the entry point for the main process.
- `src/renderer.ts` - the entry point for the "renderer," the code running in the Chromium window.
- `vendor/wp-now` - the modified `wp-now` source code.

### Code Formatting

Code formatting is set up to make merging pull requests easier. It uses the same Prettier/ESLint mechanism as Calypso, the code powering the WordPress.com dashboard. See [JavaScript Coding Guidelines](https://github.com/Automattic/wp-calypso/blob/trunk/docs/coding-guidelines/javascript.md) for guidance on setting up your editor for code formatting.

### CLI Development

The CLI relies upon a separate instance of the app to run. When developing the CLI, the CLI can be invoked with the following steps:

- Run `npm start` to launch the first instance of the app.
- Within the `forge.config.ts` file, change the `WebpackPlugin` ports used for the second instance:
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

## Debugging

The renderer process can be debugged using the Chromium developer tools. To open the developer tools, press <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on Mac or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> on Windows.

The React tree in the renderer process can be debugged with the standalone [React Developer Tools](https://react.dev/learn/react-developer-tools#safari-and-other-browsers). To do this, start the the React Developer Tools and then start the app with the `REACT_DEV_TOOLS=true` flag set.

First, install and run the React Developer Tools:

```bash
npx react-devtools
```

Then start the app with the `REACT_DEV_TOOLS=true` flag:

```bash
REACT_DEV_TOOLS=true npm start
```

The main process can be debugged using the Node.js inspector. To do this, run the app with the `--inspect-brk-electron` flag:

```bash
npm start -- --inspect-brk-electron
```

Then open `chrome://inspect` in a Chromium-based browser and click "inspect" next to the process you want to debug.

## Building Installers

Once all required dependencies are installed, you can build installers for the app.
Installers can currently be built on Mac (Intel or Apple Silicon) and Windows with the following command:

```bash
npm install
npm run make
```

### Linux

While not officially supported yet, Linux builds can be created using the instructions provided above. Here's a more detailed guide for Linux users:

1. **Building the Application**

   Follow these steps to build the application on Linux:

   ```bash
   npm install
   npm run make
   ```

   After the build process completes, you'll find a folder named `Studio-linux-x64` under the `out/` directory.

2. **Running the Application**

   To run the executable, navigate to the `Studio-linux-x64` directory and use the following command:

   ```bash
   ./studio
   ```

3. **Creating a Desktop Entry**

   To integrate the application with your Linux desktop environment, you can create a desktop entry file. This allows you to launch the application from your system's application menu and associate it with specific file types or protocols.

   Create a new file named `studio.desktop` in the `~/.local/share/applications/` directory:

   ```bash
   mkdir -p ~/.local/share/applications
   nano ~/.local/share/applications/studio.desktop
   ```

   Paste the following content into the file, making sure to replace `<absolute-path-to-repo>` with the actual path to your project repository:

   ```
   [Desktop Entry]
   Name=Studio By WordPress.com
   Comment=WordPress.com Studio Development Version
   Exec=<absolute-path-to-repo>/out/Studio-linux-x64/studio %U
   Icon=<absolute-path-to-repo>/assets/icon.png
   Type=Application
   Terminal=false
   MimeType=x-scheme-handler/wpcom-local-dev;
   Categories=Development;
   ```

   Save the file and exit the text editor.

4. **Updating the Desktop Database**

   After creating the desktop entry, update the desktop database to ensure the new entry is recognized:

   ```bash
   update-desktop-database ~/.local/share/applications
   ```

5. **Troubleshooting**

   - For systems using Wayland, you may need to set the `--enable-features=UseOzonePlatform --ozone-platform=wayland`
     flag when running the application.

6. **Known Limitations**

   - Some features may not work as expected on Linux due to platform-specific implementations.
   - The auto-update feature is not currently supported on Linux builds.

Please note that while these instructions should work for most Linux distributions, you
may need to adjust them based on your specific setup or distribution.

## Localization

See [Localization](./localization.md) documentation.

## Versioning and Updates

See [Versioning and Updates](./versioning-and-updates.md) documentation.
