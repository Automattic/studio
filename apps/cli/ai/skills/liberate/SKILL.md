---
name: liberate
description: Import an existing website (Wix, Squarespace, Webflow, Shopify, GoDaddy, Hostinger, HubSpot, Weebly, or any public site) into a new Studio WordPress site as an editable block theme, then measure how faithfully it was captured. Invoke when the user wants to migrate, import, liberate, or rebuild a website from a URL.
---

# Liberate a website into Studio

Studio imports a website in two stages: Data Liberation captures the site as a portable copy, then the Static Site Importer rebuilds it as a native block theme. `studio create --from` installs the newest release of each on every run. Everything below uses the CLI through Bash.

## 1. Import

Ask for the website URL if the user has not given one; it must be a public `https://` URL. Tell the user an import usually takes 10–15 minutes.

```bash
studio create --from <url> --name "<site name>" --path ~/Studio/<slug> --keep-source --skip-browser
```

`--keep-source` keeps the capture in the sibling `~/Studio/<slug>-source` directory so it can be measured afterwards. Run the command with a timeout of at least 20 minutes. It prints progress, a fidelity summary, the site URL and admin credentials, and, because the capture was kept, the exact `data-liberation compare` command for the next step.

If a page fails to capture, the import stops rather than building a site with missing pages; share the reported pages and suggest a retry. If the importer rejects the result, share its failure detail. Do not hand-build the site as a substitute.

## 2. Measure the capture

Run the `data-liberation compare` command that `studio create` printed. It checks every captured route offline and compares a sample of routes against the live source at widths the capture never sampled:

```bash
npx --yes --package=<data-liberation release tarball> data-liberation compare ~/Studio/<slug>-source/<host>
```

If it reports that a browser is missing, install it once with the same package, then run compare again:

```bash
npx --yes --package=<data-liberation release tarball> playwright install chromium
```

`compare` exits 0 when every check passes. Otherwise its output lists each failing route and width with the measured difference (text, geometry, images, typography).

## 3. Iterate

Compare measures the capture against the live source; it is evidence, not a pass or fail on the WordPress site. Use it to decide what to look at:

- **Failures that point at the source**, such as a transient HTTP error, a page behind a login, or content that changed since capture: re-run step 1, then compare again.
- **Failures in the capture itself**: report the exact compare lines to the user. Improving capture fidelity is a Data Liberation change, not a site edit.
- **Differences between the capture and the WordPress site**: open the site and the kept capture side by side, take screenshots, and fix them in the generated block theme and pages so the site stays editable in the block editor.

Repeat compare after each change until it passes or the remaining differences are understood and reported.

## Report

Share the site URL and credentials, how many pages were captured, the final compare result, and anything flagged for the user's attention.
