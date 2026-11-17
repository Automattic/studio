---
name: liberate
description: Liberate any website into a portable HTML copy and import it into WordPress using the Studio CLI. Then work with the user to make sure it looks and function like the original. Use this when the user wants to migrate, import, move, liberate, or rebuild a website from a URL.
user-invokable: true
---

# Liberate a Website

## 1. Bring the site over

The source is a public `https://` address, or a folder or `.zip` of the site's files on this computer. For an address, Data Liberation first copies every page of the original — the longest part, growing with the number of pages — then Static Site Importer rebuilds the copy as a WordPress site.

```bash
studio create --from <url> --name "<site name>" --path ~/Studio/<slug> --keep-source --skip-browser
studio create --from <path> --name "<site name>" --path ~/Studio/<slug> --skip-browser
```

Run it with a timeout of at least 20 minutes. Its output says which pages could not be copied, how to resume an import that stopped, and, for an address, the command that compares the new site with the original page by page, at several screen sizes.

## 2. Make it match

Make the new site the active site with `site_info`, and share its address and login details. Run the comparison with the site running; a folder of files has none, so compare it with the original files yourself. Tell the user what differs, and ask them to point out anything else.

Fix each difference on the new site with blocks, so the user can keep editing everything in the WordPress editor. Run the comparison again after a batch of fixes, until it is clean or the user is happy with what remains.
