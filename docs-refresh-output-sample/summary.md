## Docs refresh: trunk

The two changes in the brief need no docs edits. WordPress.com push and pull behind a sites capability (#5897) is an internal refactor. The capture harness (#5641) is tooling. But the recaptured screenshots showed UI changes on trunk that the pages hadn't caught up with: the site menu regroup (#5849), the composer + menu, and provider labels. The pages now follow the source in this checkout.

### Pages changed

- **`sites.md`**
  - Site menu: the image alt text and the list now match the menu's order and items: **Stop**, **Tools**, **Open in**, **Pin**, **Rename**, **Duplicate**, **Settings**, **Share**, **Publish**, **Export**, **Delete**.
  - **Restart** and **Import** are no longer in the menu. The page now says they're in the command palette as **Restart site** and **Import backup…**.
  - **New chat** only shows once a provider is connected (logged in to WordPress.com, or your own API key).
  - **Delete site** is now **Delete**, here and under "Delete a site".
  - The site Settings image alt text mentions the **Do more with WordPress** card shown when logged out.
- **`import-export.md`**: updating an existing site from a backup now goes through the command palette's **Import backup…**, since the site menu has no **Import**.
- **`studio-code/index.md`**
  - Slash commands: **+** shows the most common commands. **Choose model** only appears when you type `/`.
  - **Annotate** is listed as a command. The skill names are now **Performance audit** and **SEO audit**, as the source has them.
  - The + menu alt text is updated to match.
  - The model section says to type `/model` rather than pick **Choose model** from **+**.
  - The provider is called **Anthropic API** in **Settings → Providers**, in the text and in the alt text.
- **`studio-code/choosing-an-ai-model-tier-in-studio-code.md`**: model menu alt text, **Connect provider…** → **Connect providers**.
- **`frequently-asked-questions.md`**: **Anthropic** → **Anthropic API** in **Settings → Providers**.
- **`index.md`**: you can also log in from **Connect** on a site's **Settings** page.

### Screenshots

- **Repaired `annotate-staged`** (`60-signed-in.json`). The real cause was a race. When the window was still loading the signed-in provider state, clicking **Annotate** opened "Put your feedback to work" instead of turning Annotate on. That silently broke `annotate-toolbar` and `annotate-note`, and then `annotate-staged` timed out. The fixes:
  - `annotate-toolbar` now waits for the **Model** button, which only appears once a provider is connected, before clicking **Annotate**.
  - `annotate-note` no longer presses Escape afterwards. Pressing Escape could close Annotate when the draft was empty.
  - `annotate-staged` clicks **Delete annotation** inside the open **Annotation** note.
  - All three captured correctly with `--driver electron` and were reviewed.
- **Recaptured every shot the brief flagged as changed** (browser driver), plus the Desktop-only `annotate-toolbar`, `annotate-note`, `annotate-staged` and `settings-studio-cli` (Electron driver). I reviewed the menus, dialogs, settings pages and Annotate shots by eye. A subagent compared the rest against their pages' alt text and surrounding text. The differences are the new site menu and + menu, the new Annotate icon and its select/draw toolbar, updated settings copy and spacing, and the provider label. None shows anything broken.
- Finished with a full `npm --prefix docs/user run screenshots`.

### Needs a person

- **Pre-existing app changes**: the site menu, + menu and settings changes come from trunk merges before this brief's range (#5849, #5836 and others), not from its two PRs. I documented them because the code in this checkout does it. Worth a glance that trunk is what the published docs should describe.
- **Floating toolbar**: the Annotate section doesn't describe the select/draw/delete toolbar at the bottom of the preview (rectangle selection and drawing tools from #5793/#5799). I left it alone rather than describe drawing behavior I couldn't fully exercise.
- **Shots unused by any page**: several shots aren't used by any page in `docs/user/docs` (for example `settings-general`, `site-settings-php`, `publish-panel`), so only their images were refreshed.
- **`annotate-staged` outline**: the blue hover outline is still on the photo after its note is deleted, the same as the previous committed image.
