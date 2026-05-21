# Linux Guide

Studio is available for Linux. Most users should install the published Debian package; developers can also build from source.

## Install Studio

Studio publishes `.deb` packages for x64 and ARM64 architectures, suitable for Debian, Ubuntu, and derivatives.

1. Download the latest `.deb` for your architecture from the [Studio releases page](https://github.com/Automattic/studio/releases).
   - `studio-x64-v<version>.deb` for Intel/AMD 64-bit systems
   - `studio-arm64-v<version>.deb` for ARM 64-bit systems

2. Install the package:
   ```bash
   sudo apt install ./studio-x64-v*.deb
   ```

## Updating

Studio checks for updates automatically and surfaces a dialog with a Download button when a new version is available. Clicking Download opens your browser to fetch the latest `.deb`; install it with `sudo apt install ./<file>.deb` to apply the update.

You can also re-download the latest `.deb` from the [releases page](https://github.com/Automattic/studio/releases) at any time.

## Known Limitations

- For systems using Wayland, you may need to launch Studio with the `--enable-features=UseOzonePlatform --ozone-platform=wayland` flag.
- Some features may behave differently on Linux due to platform-specific implementations.
- Please [open an issue](https://github.com/Automattic/studio/issues) if you hit problems.

## Running with Wayland

If you're using Wayland instead of X11, launch Studio with additional flags:

```bash
studio --enable-features=UseOzonePlatform --ozone-platform=wayland
```

To persist the flags, copy `/usr/share/applications/studio.desktop` to `~/.local/share/applications/` and edit the `Exec=` line there.

## Building from Source

If you're contributing to Studio or running it on a distribution where the `.deb` doesn't work, you can build directly from the repository.

### Prerequisites

Ensure you have the following dependencies installed:

- [Node.js](https://nodejs.org/) — required JavaScript runtime environment
- [Python](https://www.python.org/) — required for building native dependencies
- [setuptools](https://pypi.org/project/setuptools/) — required for building native dependencies

Many contributors use [`nvm`](https://github.com/nvm-sh/nvm) to manage Node.js installations.

### Build Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Automattic/studio.git
   cd studio
   ```

2. **Install dependencies:**
   ```bash
   nvm use
   npm install
   ```

3. **Build the application:**
   ```bash
   npm run package
   ```

   This creates an `out/` folder inside `apps/studio/`.

4. **Locate the executable:**

   Navigate to `apps/studio/out/Studio-linux-x64/`. Inside, you'll find a `studio` executable.

5. **Run Studio:**
   ```bash
   cd apps/studio/out/Studio-linux-x64
   ./studio
   ```

To build a `.deb` package instead of the unpackaged binary, run `npm run make:linux-x64` or `npm run make:linux-arm64`. The output lands in `apps/studio/out/make/deb/<arch>/`.

### Creating a Desktop Shortcut (source builds only)

`.deb` installs register a desktop entry automatically. For source builds you can create one manually:

1. **Create the file:**
   ```bash
   nano ~/.local/share/applications/studio.desktop
   ```

2. **Add the following content:**
   ```ini
   [Desktop Entry]
   Name=Studio by WordPress.com
   Icon=<absolute-path-to-repo>/assets/studio-app-icon.png
   Comment=Local WordPress development environment
   Exec=<absolute-path-to-repo>/apps/studio/out/Studio-linux-x64/studio %U
   Type=Application
   Terminal=false
   MimeType=x-scheme-handler/wp-studio;
   Categories=Development;
   ```

3. Replace `<absolute-path-to-repo>` with the actual absolute path to your cloned repository.

4. **Refresh your application menu:**
   ```bash
   update-desktop-database ~/.local/share/applications
   ```

5. **Register Studio as the `wp-studio://` handler:**
   ```bash
   xdg-mime default studio.desktop x-scheme-handler/wp-studio
   ```
   Without this, browsers will still show "Open With… / No Apps Available" when WordPress.com OAuth redirects back to `wp-studio://`.

### Updating a Source Build

```bash
cd <path-to-repo>
git pull
npm install
npm run package
```

## Troubleshooting

### Permission issues running a source build

If you encounter permission issues when running `./studio` from a source build, make sure it has execute permissions:

```bash
chmod +x apps/studio/out/Studio-linux-x64/studio
```

### `npm start` fails with a Chrome sandbox error (Ubuntu 24.04+)

On distributions that restrict unprivileged user namespaces via AppArmor (notably Ubuntu 24.04+), `npm start` may abort with `FATAL: ... The SUID sandbox helper binary was found, but is not configured correctly`. Electron falls back to its SUID sandbox because AppArmor blocks the user-namespace sandbox by default.

Allow the user-namespace sandbox persistently:

```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-apparmor-namespace.conf
sudo sysctl --system
```

The setting survives reboots and `npm install` runs, so you only need to do this once per machine.

This only affects `npm start` during development; installed `.deb` packages ship a properly-configured SUID sandbox binary and are unaffected.

### Missing system libraries (source builds)

`.deb` installs declare their system dependencies automatically. If you're running a source build and encounter errors about missing libraries, install the common dependencies:

```bash
# Debian/Ubuntu
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret

# Arch
sudo pacman -S gtk3 libnotify nss libxss libxtst xdg-utils at-spi2-core util-linux libsecret
```

## Contributing

If you encounter Linux-specific issues or have suggestions for improving Linux support, please [open an issue](https://github.com/Automattic/studio/issues) or submit a pull request. Your feedback helps improve Studio for all Linux users!
