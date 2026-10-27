---
name: build-site
description: Build a new website in WordPress Studio.
user-invokable: true
---

# Build a New Site

## What the site is for

Start from what the user needs the site to do. Work out who visits it, what they come to find (what the business offers, its prices, hours, location, contact details), and what they come to do (book, order, call, visit, write). Everything the user told you goes on the site where a visitor looks for it. Each thing a visitor comes to do gets a clear way to do it. The site has the pages the user asked for, and one page when they asked for one.

## Its own theme

Unless the user names a theme, give the site a block theme of its own, named for the site, and activate it. Read the default theme's files (`WP_DEFAULT_THEME`) for how WordPress lays one out. The theme carries the look: the site's palette, fonts and spacing in `theme.json`, a header with the site's name and navigation to what visitors come for, a footer with the site's details, and a `front-page.html` template. The pages hold the content.

## A first pass, then the user

Build a whole first pass from what the user asked, then tell them what you made and the choices behind it, and offer `/annotate` for changes.
