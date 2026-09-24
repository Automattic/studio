---
name: liberate
description: Liberate any website into a portable HTML copy and import it into WordPress using the Studio CLI. Then work with the user to make sure it looks and function like the original. Use this when the user wants to migrate, import, move, liberate, or rebuild a website from a URL.
---

## 1. Bring the site over

Ask where the website lives if the user has not already provided a URL. It can be a public address starting with `https://`, or a folder or `.zip` of the site's files on this computer.

For an address, the import has two stages: first Data Liberation copies every page of the original site, then Static Site Importer rebuilds that copy as a WordPress site. Copying takes longest and grows with the number of pages, so a small site takes a few minutes and a large one can take much longer. Tell the user what to expect.

Import it with the Studio CLI. For a website address:

```bash
studio create --from <url> --name "<site name>" --path ~/Studio/<slug> --keep-source --skip-browser
```

For a folder or `.zip` of website files, pass its path instead and leave out `--keep-source`:

```bash
studio create --from <path> --name "<site name>" --path ~/Studio/<slug> --skip-browser
```

Run it with a timeout of at least 20 minutes. For an address, `--keep-source` keeps the copy of the original in a `<path>-source` folder next to the new site, which the comparison below uses.

If a few pages could not be copied, the import still finishes without them and lists them with the reason each one failed; tell the user which pages are missing. The import stops instead when the home page could not be copied, or more than one page in ten; report the reason it printed rather than guessing at one.

If the import stops after the site was created, the site is kept and `studio create` says so. Re-running the same command continues that import instead of starting a new site; it copies the original again first. If it stops before the site was created, re-running starts over.

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
