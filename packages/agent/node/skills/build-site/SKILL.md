---
name: build-site
description: Build a new website in WordPress Studio.
user-invokable: true
---

# Build a New Site

## 1. Build a first version

Build the whole site from the user's request without asking first: everything they told you goes on it, and anything they left out, choose for them. Everything the user asks the site to do works on the first version: a shop sells, a signup subscribes. Each site gets a custom block theme, made with `create_theme`, unless the user says otherwise. The site's content goes in pages; the theme frames it.

## 2. Show it

Tell the user what you built: the pages and sections, what a visitor can do on the site, and the choices you made for them (look, wording, imagery). Name anything a visitor needs that only the user can give, such as a phone number or prices, as a question for them to answer. Ask what they'd like changed; they can describe it, or point at it on the site with `/annotate`. End with a short **Next steps** list: those questions first, then the audits they can ask for now, a performance audit (`/need-for-speed`) and an SEO audit (`/rank-me-up`). This reply ends the turn, and its questions are asked in it: the answers arrive as the user's next message.

## 3. Iterate with them

Make the changes each reply asks for, then show what changed and ask again in the same way, until they're happy with it.
