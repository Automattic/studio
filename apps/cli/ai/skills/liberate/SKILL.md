---
name: liberate
description: Move an existing website (Wix, Squarespace, Webflow, Shopify, GoDaddy, Hostinger, HubSpot, Weebly, or any public site) into a new Studio WordPress site, then work with the user to make it look and work like the original. Invoke when the user wants to migrate, import, move, liberate, or rebuild a website from a URL.
---

# Move a website into Studio

The user is usually not technical. Speak plainly, keep them informed, and never ask them to run commands or read logs. You run everything.

## 1. Bring the site over

Ask for the website's address if the user has not given one. It must be a public address starting with `https://`. Let them know this usually takes 10 to 15 minutes, and that you will tell them when it is ready.

```bash
studio create --from <url> --name "<site name>" --path ~/Studio/<slug> --keep-source --skip-browser
```

Run it with a timeout of at least 20 minutes. `--keep-source` keeps a copy of the original next to the new site so you can compare against it later.

If the import stops because some pages could not be copied, tell the user which pages, explain that the original site may have been briefly unavailable, and offer to try again.

## 2. Show the user their new site

When the import finishes, open the new site and share its address and login details. Take screenshots of the home page and one or two other key pages, alongside the same pages on the original site, so the user can see the result for themselves.

## 3. Fix what looks different, together

Ask the user what looks wrong or is missing. At the same time, compare the new site against the original yourself, page by page, on both a wide screen and a phone-sized screen. Look for:

- missing or moved text, images, and sections
- wrong fonts, sizes, or colors
- navigation or buttons that do not work
- anything that looks broken on a phone

To check whether the original was copied faithfully, you can also run the comparison command that `studio create` printed. It reports pages and screen sizes where the copy differs from the original.

Fix each difference on the new site itself. Edit its pages and its theme using block editor blocks, so the user can keep editing everything in the WordPress editor afterwards. Avoid raw HTML blocks and custom code the user cannot edit.

After each fix, take a fresh screenshot, show the user, and ask whether it looks right. Keep going, one change at a time, until the user is happy.

## 4. Wrap up

Summarize what was brought over, what you changed together, and anything that still differs from the original. Point the user to the WordPress editor for future changes.
