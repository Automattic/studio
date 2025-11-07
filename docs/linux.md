# Linux Guide

Studio for Linux is currently in an experimental phase. While official packages are not yet available, you can easily build and run Studio from source on most Linux distributions.

## Current Limitations

Linux support comes with certain limitations:
- For systems using Wayland, you may need to set the `--enable-features=UseOzonePlatform --ozone-platform=wayland` flag when running the application.
- Some features may not work as expected on Linux due to platform-specific implementations.
- The auto-update feature is not currently supported on Linux builds.
- These instructions should work for most Linux distributions, but you may need to adjust them based on your specific setup or distribution.

## Building from Source

### Prerequisites

Ensure you have the following dependencies installed:

- [Node.js](https://nodejs.org/) - required JavaScript runtime environment
- [Python](https://www.python.org/) - required for building native dependencies
- [setuptools](https://pypi.org/project/setuptools/) - required for building native dependencies

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
   
   This will create an `out/` folder in the project root.

4. **Locate the executable:**
   
   Navigate to the `out/Studio-linux-x64/` folder. Inside, you'll find a `studio` executable.

5. **Run Studio:**
   ```bash
   cd out/Studio-linux-x64
   ./studio
   ```

## Creating a Desktop Shortcut (Optional)

For easier access, you can create a desktop entry file that will add Studio to your application launcher.

### Steps

1. **Create a desktop file:**
   ```bash
   nano ~/.local/share/applications/studio.desktop
   ```

2. **Add the following content:**
   ```ini
   [Desktop Entry]
   Name=Studio by WordPress.com
   Icon=<absolute-path-to-repo>/assets/studio-app-icon.png
   Comment=Local WordPress development environment
   Exec=<absolute-path-to-repo>/out/Studio-linux-x64/studio %U
   Type=Application
   Terminal=false
   MimeType=x-scheme-handler/wp-studio;
   Categories=Development;
   ```

3. **Replace placeholders:**
   - Replace `<absolute-path-to-repo>` with the actual absolute path to your cloned repository
   - For example: `/home/username/projects/studio`

4. **Make the desktop file executable (if needed):**
   ```bash
   chmod +x ~/.local/share/applications/studio.desktop
   ```

5. **Refresh your application menu:**
   
   Depending on your desktop environment, you may need to log out and back in, or run:
   ```bash
   update-desktop-database ~/.local/share/applications
   ```

Studio should now appear in your application launcher and can handle `wp-studio://` protocol URLs.

## Running with Wayland

If you're using Wayland instead of X11, run Studio with additional flags:

```bash
./studio --enable-features=UseOzonePlatform --ozone-platform=wayland
```

You can add these flags to the `Exec` line in your desktop file if you created one:

```ini
Exec=<absolute-path-to-repo>/out/Studio-linux-x64/studio --enable-features=UseOzonePlatform --ozone-platform=wayland %U
```

## Troubleshooting

### Permission Issues

If you encounter permission issues when running the executable, make sure it has execute permissions:

```bash
chmod +x out/Studio-linux-x64/studio
```

### Missing Dependencies

If you encounter errors about missing libraries, you may need to install additional system dependencies. Common packages include:

```bash
# Debian/Ubuntu
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret

# Arch
sudo pacman -S gtk3 libnotify nss libxss libxtst xdg-utils at-spi2-core util-linux libsecret
```

## Updating Studio

Since auto-updates are not supported on Linux builds, you'll need to manually update:

1. Pull the latest changes from the repository:
   ```bash
   cd <path-to-repo>
   git pull
   ```

2. Reinstall dependencies and rebuild:
   ```bash
   npm install
   npm run package
   ```

The executable in `out/Studio-linux-x64/` will be updated with the new version.

## Contributing

If you encounter Linux-specific issues or have suggestions for improving Linux support, please [open an issue](https://github.com/Automattic/studio/issues) or submit a pull request. Your feedback helps improve Studio for all Linux users!

