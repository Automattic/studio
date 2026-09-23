---
name: liberate
description: Move an existing website (Wix, Squarespace, Webflow, Shopify, GoDaddy, Hostinger, HubSpot, Weebly, any public site, or a folder of website files) into a new Studio WordPress site, then work with the user to make it look and work like the original. Invoke when the user wants to migrate, import, move, liberate, or rebuild a website from a URL.
---

# Move a website into Studio

The user is usually not technical. Speak plainly, keep them informed, and never ask them to run commands or read logs. You run everything.

Set expectations up front: the import gets most of the way there, and you will then fix what came out differently, together. A first import is rarely perfect.

## 1. Bring the site over

Ask where the website is if the user has not said. It can be a public address starting with `https://`, or a folder or `.zip` of the site's files on this computer. Let them know an address usually takes 10 to 15 minutes, and that you will tell them when it is ready.

Import it with the Studio CLI. For a website address:

```bash
studio create --from <url> --name "<site name>" --path ~/Studio/<slug> --keep-source --skip-browser
```

For a folder or `.zip` of website files, pass its path instead and leave out `--keep-source`:

```bash
studio create --from <path> --name "<site name>" --path ~/Studio/<slug> --skip-browser
```

Run it with a timeout of at least 20 minutes. For an address, `--keep-source` keeps a copy of the original next to the new site so the two can be compared.

If the import stops because some pages could not be copied, tell the user which pages, explain that the original site may have been briefly unavailable, and offer to try again.

## 2. Find what came out differently

When the import finishes, make the new site the active site with `site_info` and share its address and login details.

For a website address, `studio create` prints a command at the end of the import that compares the new site with the original, page by page, at several screen sizes including a phone. Run it; the site must be running. It lists each page and screen size where the new site differs, and what differs: missing text, different fonts or sizes, moved or missing images, or menus and buttons that do not open.

For a folder of files there is no automatic comparison; open the original files alongside the new site and compare them yourself.

Tell the user, in plain words, what you found. Ask them to look through the site too and point out anything that looks wrong or is missing.

## 3. Fix it, one change at a time

Fix each difference on the new site itself. Edit its pages and its theme using block editor blocks, so the user can keep editing everything in the WordPress editor afterwards. Avoid raw HTML blocks and custom code the user cannot edit.

After each fix, refresh the site preview so the user sees the change, and ask whether it looks right. When you have the comparison, run it again after a batch of fixes to confirm them and catch anything new. Keep going until the comparison is clean or the user is happy with what remains.

## 4. Wrap up

Summarize what was brought over, what you changed together, and anything that still differs from the original. Point the user to the WordPress editor for future changes.
