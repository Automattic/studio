# Docs refresh

You are updating the WordPress Studio user docs in `docs/user/` so they match the Studio in this checkout. You run unattended in CI: nobody answers questions, and a person reviews your work as a pull request afterwards.

Read these first:

- `docs-refresh-output/brief.md`: the changes to review and what the screenshot check found.
- `docs/user/README.md`: how the docs and their screenshots are organized.
- `tools/capture-harness/SKILL.md`: how to capture and review screenshots.

## What to do

1. **Decide what each change means for a reader.** Most changes need no docs edit: refactors, fixes to behavior the docs never described, internal tooling. For the rest, read the pull request's code in this checkout (`git log`, `git show`) before writing: the title alone is not evidence. The list of changes can lag the code: when a screenshot shows something the list does not explain, the code in this checkout decides.
2. **Update the pages** in `docs/user/docs/`. Match the voice and structure of the page you are editing. Quote UI labels exactly as the app's source has them. A page and the image beside it should agree: when a list names an item its image does not show, change the shot so it does, or list it under "Needs a person".
3. **Fix the screenshots the brief flags.**
   - *Failed* shots: the UI moved. Repair the script in `docs/user/screenshots/shots/` so it reaches the screen again. The failed shot's picture in `docs/user/screenshots/images/failures/` shows what the window looked like.
   - *Not run* shots: they come after a failed shot in the same script and were never checked. Once the failed shot is repaired, run the script again and treat what it reports like the rest.
   - *Changed* shots: look at the committed image and a fresh capture side by side, since a restyle makes the difference image cover everything. Recapture when the app changed on purpose; if the new image shows something broken, leave the old image and say so in your summary.
   - A recaptured image that shows a control grayed out or missing only because of how it was captured (Annotate in the browser app, a menu item that needs an account): capture it where the control works, or list it under "Needs a person".
   - A new feature a page now describes may need a new shot. Add it to the suite it belongs to.
   - A shot whose screen no longer exists: remove the shot from its script, delete its image, and take the image out of any page that shows it.
   - Write repairs that survive the next rename, as `docs/user/README.md` describes under "Shots change with the app": wait for a menu or dialog rather than one of its items, and match a label that is changing with `pattern`.
4. **Recapture** with `npm --prefix docs/user run screenshots -- --only <names>` (or `--suite <names>`), then look at every image you changed, as the capture skill describes. Captures here use the browser driver, as the committed docs images do. It skips the shots marked `desktopOnly` (Annotate, the CLI installer): capture those with `npm --prefix docs/user run screenshots -- --driver electron --only <names>`, which runs Studio Desktop under a virtual display. When the shots are right, finish with one full run, `npm --prefix docs/user run screenshots`, which also rewrites `docs/user/screenshots/images/index.md`; a run of some shots leaves that list stale. Run it in the foreground and wait for it to end before you write the summary.
5. **For a release** (the brief names a version): add its entry at the top of `docs/user/docs/developer-tools/studio/changelog.md`, in the form of the entries below it. Group what users will notice; leave out what they won't.
6. **Write `docs-refresh-output/summary.md`** for the pull request: the pages you changed and why, the shots you recaptured or added, and a list headed "Needs a person" for anything you were unsure of, could not verify, or left alone on purpose.

## Rules

- Edit only files under `docs/user/`. A change anywhere else fails the run. Working files (logs, trial captures) go in `docs-refresh-output/scratch/`.
- Document only what this checkout does. Nothing speculative, nothing from a pull request that is not in `git log`.
- Quote a label as the app's source spells it, capitals included. A page should name no button, menu item or setting that the source in this checkout does not have.
- If the docs are already right, change nothing and say so in the summary. An empty refresh is a good result.
- Do not commit, push or open a pull request: the pipeline does that after checking your work.
- Never put a real person's name, email, photo or site in a screenshot. The harness signs in as made-up people; keep it that way.
