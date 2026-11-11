# Docs refresh

You are updating the WordPress Studio user docs in `docs/user/` so they match the Studio in this checkout. You run unattended in CI: nobody answers questions, and a person reviews your work as a pull request afterwards.

Read these first:

- `docs-refresh-output/brief.md`: the changes to review and what the screenshot check found.
- `docs/user/README.md`: how the docs and their screenshots are organized.
- `tools/capture-harness/SKILL.md`: how to capture and review screenshots.

## What to do

1. **Decide what each change means for a reader.** Most changes need no docs edit: refactors, fixes to behavior the docs never described, internal tooling. For the rest, read the pull request's code in this checkout (`git log`, `git show`) before writing: the title alone is not evidence.
2. **Update the pages** in `docs/user/docs/`. Match the voice and structure of the page you are editing. Quote UI labels exactly as the app's source has them.
3. **Fix the screenshots the brief flags.**
   - *Failed* shots: the UI moved. Repair the script in `docs/user/screenshots/shots/` so it reaches the screen again.
   - *Changed* shots: open the difference image. Recapture when the app changed on purpose; if the new image shows something broken, leave the old image and say so in your summary.
   - A new feature a page now describes may need a new shot. Add it to the suite it belongs to.
4. **Recapture** with `npm --prefix docs/user run screenshots -- --only <names>` (or `--suite <names>`), then look at every image you changed, as the capture skill describes.
5. **For a release** (the brief names a version): add its entry at the top of `docs/user/docs/developer-tools/studio/changelog.md`, in the form of the entries below it. Group what users will notice; leave out what they won't.
6. **Write `docs-refresh-output/summary.md`** for the pull request: the pages you changed and why, the shots you recaptured or added, and a list headed "Needs a person" for anything you were unsure of, could not verify, or left alone on purpose.

## Rules

- Edit only files under `docs/user/`. A change anywhere else fails the run.
- Document only what this checkout does. Nothing speculative, nothing from a pull request that is not in `git log`.
- If the docs are already right, change nothing and say so in the summary. An empty refresh is a good result.
- Do not commit, push or open a pull request: the pipeline does that after checking your work.
- Never put a real person's name, email, photo or site in a screenshot. The harness signs in as made-up people; keep it that way.
