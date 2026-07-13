# Linux

Linux-specific build steps and troubleshooting for contributors. See also [code-contributions.md](./code-contributions.md) for general setup.

## Building from Source

To build a runnable app bundle from a clone:

```bash
npm install
npm run package
```

The executable will be at `apps/studio/out/Studio-linux-<arch>/studio`. To produce a `.deb` package instead, run `npm run make` (auto-detects the host arch); output lands in `apps/studio/out/make/deb/<arch>/`. To make arch specific build, use `npm run make:linux-x64` or `npm run make:linux-arm64

## Creating a Desktop Shortcut

`.deb` installs register a desktop entry automatically. For source builds you can create one manually:

```bash
nano ~/.local/share/applications/studio.desktop
```

Add the following, replacing `<absolute-path-to-repo>` with the actual path to your clone and `<arch>` with `x64` or `arm64` to match your build:

```ini
[Desktop Entry]
Name=Studio by WordPress.com
Icon=<absolute-path-to-repo>/apps/studio/assets/studio-app-icon.png
Comment=Local WordPress development environment
Exec=<absolute-path-to-repo>/apps/studio/out/Studio-linux-<arch>/studio %U
Type=Application
Terminal=false
MimeType=x-scheme-handler/wp-studio;
Categories=Development;
```

After creating the file, refresh the application menu so the entry appears:

```bash
update-desktop-database ~/.local/share/applications
```

## Registering the `wp-studio://` URL handler

When working on OAuth/login flows from a source build, register the binary as the `wp-studio://` handler so browser callbacks reach your dev build:

```bash
xdg-mime default studio.desktop x-scheme-handler/wp-studio
```

This depends on the `.desktop` file from the previous section. Without it, browsers will show "Open With… / No Apps Available" when WordPress.com OAuth redirects back, or hand the callback off to an installed `.deb` build (masking the bug you're trying to debug).

## Troubleshooting

If `./studio` fails with a permission error, ensure it has execute permissions:

```bash
chmod +x apps/studio/out/Studio-linux-<arch>/studio
```

On Ubuntu 24.04+ and other distributions that restrict unprivileged user namespaces via AppArmor, `npm start` may abort with `FATAL: ... The SUID sandbox helper binary was found, but is not configured correctly`. Electron falls back to its SUID sandbox because AppArmor blocks the user-namespace sandbox by default. Allow it persistently:

```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-apparmor-namespace.conf
sudo sysctl --system
```

The setting survives reboots and `npm install` runs, so you only need to do this once per machine. This only affects `npm start` during development; installed `.deb` packages ship a properly-configured SUID sandbox binary and are unaffected.

If you encounter errors about missing libraries on a source build (`.deb` installs declare their dependencies automatically), install the common system packages:

```bash
# Debian/Ubuntu
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret

# Arch
sudo pacman -S gtk3 libnotify nss libxss libxtst xdg-utils at-spi2-core util-linux libsecret
```
