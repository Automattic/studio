# SSL in Studio

WordPress Studio includes support for HTTPS, allowing you to create sites with secure connections that more closely resemble production environments. This feature makes your local development experience more realistic and helps identify potential issues that might only occur with HTTPS.

## [Overview](#0-overview)

The SSL support feature in WordPress Studio enables:

-   Creating sites with HTTPS enabled
-   Using custom domains with proper SSL certificates
-   Automatic certificate management
-   Browser compatibility without security warnings (when trusted)

## [How it works](#1-how-it-works)

WordPress Studio implements SSL support through the following components:

-   **Certificate Authority (CA)**: Studio creates its own Certificate Authority that signs certificates for your local sites.
-   **Domain Certificates**: Each site with HTTPS enabled receives its own certificate signed by the CA.
-   **Certificate Trust**: The system helps you trust the certificate on your operating system.
-   **HTTPS Redirection**: Traffic is automatically redirected from HTTP to HTTPS for sites with SSL enabled.

## [Enabling HTTPS for a site](#2-enabling-https-for-a-site)

Note that HTTPS requires a custom domain, as it cannot be used with the default localhost address.

To enable HTTPS for a new or existing site:

1.  Start by creating a new site, or open an existing site’s settings: choose **Settings** from the site menu (click the site icon at the top of the chat, or right-click the site in the sidebar).
2.  If creating a new site, expand **Advanced settings**.
3.  Turn on **Use custom domain**. In an existing site’s settings, it’s under **Local domain**.
4.  If you have not already provided one, enter a domain name (must end with `.local`) or use the automatically generated one.
5.  Turn on **Enable HTTPS**.

<!-- TODO screenshot: replace with `create-site-https.webp` from `npm run screenshots` (Studio 2.0): Create your site → Advanced settings with Use custom domain and Enable HTTPS on. -->
[![A screenshot depicting how to enable HTTPS when creating a new Studio site.](https://developer.wordpress.com/wp-content/uploads/2025/03/create-site-https.png)](https://developer.wordpress.com/wp-content/uploads/2025/03/create-site-https.png)

<!-- TODO screenshot: add `site-settings-domain.webp` from `npm run screenshots` (Studio 2.0) here: an existing site’s Local domain settings with Use custom domain and Enable HTTPS on. -->

6.  Click **Create site** or **Save**, depending on whether you are creating a new site or editing an existing one. 
7.  When prompted, give your permission for WordPress Studio to modify the system hosts file. Studio will configure everything else automatically. 
8.  For HTTPS connections, a root certificate authority will be generated and installed. On MacOS, you’ll need to manually install the certificate to avoid browser warnings. [Refer to the guide below for more details](#macos).
9.  Navigate to your site using the custom domain.

## [Certificate Trust by platform](#3-certificate-trust-by-platform)

### [Windows](#4-windows)

On Windows, WordPress Studio automatically adds the CA to your system trust store. This process requires administrator privileges, so you may see a User Account Control (UAC) prompt when enabling HTTPS.

### [MacOS](#macos)

On macOS, you need to manually trust the CA. To do this, find the certificate file that Studio automatically installs on your system:

1.  Open a terminal and run the following command: `open ~/.studio/certificates/`
2.  This will open the folder containing the certificate file (`studio-ca.crt`). Double-click the file to install the certificate and automatically open the **Keychain Access** tool on your machine.
3.  Locate the **WordPress Studio CA** certificate. You can filter the items by the word `studio`.

![A screenshot depicting the Keychain Access application on a Mac and the WordPress Studio CA certificate.](https://developer.wordpress.com/wp-content/uploads/2025/03/ssl-keychain.png)

4.  Double-click the certificate and expand the **Trust** section.
5.  Set “**Secure Sockets Layer(SSL)**” to *“***Always Trust**.” You can leave all other settings the same.

![A screenshot depicting the Keychain Access application on a Mac and how to set the SSL setting to "Always Trust" on the WordPress Studio CA certificate.](https://developer.wordpress.com/wp-content/uploads/2025/03/ssl-certificate-always-trust.png)

7.  Close the dialog and enter your password to confirm.

Once the certificate is trusted, your browser will recognize it and indicate that your HTTPS sites are secure.

### [Linux](#6-linux)

On Linux, Studio automatically imports the root certificate authority (CA) into the system bundle, Chromium-family user NSS databases, and existing Firefox profile NSS databases (apt, Snap, and Flatpak installs) when you click **Trust certificate**. Most users will not need the steps below.

Use this fallback only if auto-trust didn’t take effect.

#### Firefox (GUI)

1.  Open `about:preferences#privacy`.
2.  Scroll to **Certificates** and click **View Certificates…**.

[![The Security section of Firefox settings, with the Manage certificates button under Certificates.](https://developer.wordpress.com/wp-content/uploads/2025/03/cleanshot-2026-05-18-at-11.54.43402x.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/03/cleanshot-2026-05-18-at-11.54.43402x.png)

3.  Switch to the **Authorities** tab and click **Import…**.

[![Firefox's Certificate Manager on the Authorities tab, with the Import button.](https://developer.wordpress.com/wp-content/uploads/2025/03/cleanshot-2026-05-18-at-11.54.52402x.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/03/cleanshot-2026-05-18-at-11.54.52402x.png)

4.  Select `~/.studio/certificates/studio-ca.crt`.
5.  Check **Trust this CA to identify websites** and click **OK**.

[![Firefox's Downloading Certificate dialog asking whether to trust "WordPress Studio CA", with "Trust this CA to identify websites" checked.](https://developer.wordpress.com/wp-content/uploads/2025/03/cleanshot-2026-05-18-at-11.55.19402x.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/03/cleanshot-2026-05-18-at-11.55.19402x.png)

6.  Fully quit and relaunch Firefox.

#### Chromium / Chrome / Brave / Edge (CLI)

Install `certutil` if it isn’t already available:

```shell
sudo apt install libnss3-tools
```

Import the CA into the user NSS database:

```shell
certutil -d sql:$HOME/.pki/nssdb -A -t 'C,,' -n 'WordPress Studio CA' -i ~/.studio/certificates/studio-ca.crt
```

For Snap-Chromium, use the Snap-specific NSS database path instead:

```shell
certutil -d sql:$HOME/snap/chromium/current/.pki/nssdb -A -t 'C,,' -n 'WordPress Studio CA' -i ~/.studio/certificates/studio-ca.crt
```

Fully quit and relaunch the browser after import.

## [Troubleshooting](#7-troubleshooting)

### [Browser security warnings](#8-browser-security-warnings)

If you see browser security warnings when visiting your HTTPS-enabled site:

-   Ensure you’ve trusted the **WordPress Studio CA** certificate on your system.
-   Restart your browser after trusting the certificate.
-   Clear your browser cache if warnings persist.