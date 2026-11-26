---
name: translate-missing-strings
description: Translate the Studio UI strings that GlotPress has no translation for yet, in every supported locale, consistently with the existing translations, and save them as AI translations. Use at code freeze on the release branch, or when asked to fill missing translations.
---

# Translating the strings GlotPress is missing

Studio ships the translations from [GlotPress](https://translate.wordpress.com/projects/studio/). Strings that GlotPress hasn't translated yet would show in English, so an agent translates them at code freeze. These AI translations live in `packages/common/translations/ai/studio-<locale>.json` and are merged into the shipped `studio-<locale>.jed.json` files, below the GlotPress ones. Every later GlotPress download (each beta and the final release) merges them again and drops the ones GlotPress has translated since.

`T` below stands for `node scripts/ai-translations/index.mjs`, run from the repo root. Type the full command: zsh won't run it from a shell variable.

## When

At code freeze, on `release/<version>` after the `code_freeze` lane committed `i18n/bundle-strings.pot`: the strings are frozen there, so the translations match the code that ships. Work on a branch from it and open a PR into the release branch before the first beta.

## For each locale

`T merge` lists every locale with the number of strings left in English. For each locale with strings left:

1. `T pending --locale=<locale>` prints a line with the language, its plural rule and the Studio glossary (often `null`: then the existing translations are the only reference), then the next 100 missing strings, one JSON object per line (`--limit=<n>` for more or fewer). Each lists the `files` that use it: open them when a short string such as "Start from" is ambiguous, or when strings are pieces of one sentence ("…you can " + "buy more credits" + ".") that must read well together.
2. Translate them, following the rules below, into a JSON file in a scratch directory: `[{ "text": "…", "context": "…", "forms": [ "…" ] }]`. Copy `text` and `context` from `pending`, leaving `context` out when the string has none, and write the file with a file tool rather than through the shell, so quotes and backslashes survive.
3. `T add --locale=<locale> <file>` checks each translation, saves the valid ones and merges them. It lists the `rejected` ones with the reason: fix those and add them again. Adding a string again replaces its earlier AI translation, which is how you correct one.
4. Repeat until `pending` has no strings left.

Locales are independent of each other. With subagents, give each one its own locales, and have it pass `--locale` to every command, `merge` included, so agents never write each other's files, and report back what the PR needs (see Finish). Every locale gets nearly the same strings in the same order, so an agent with several locales can settle its reading of each string once. The first run fills every gap since the feature started (Hungarian, Polish and Ukrainian have the most); later code freezes only the strings added since the previous one.

## Translating

- **Read like the rest of the app.** Before translating a term, run `T search --locale=<locale> <words>…` (strings whose English has all the words, shortest first; `--limit=<n>`, 20 by default) to see how the existing translations render it, or `T search --locale=<locale> --exact <string>…` for the translations of whole strings, such as short labels (`--exact Fast Balanced`), and reuse their wording, tone and form of address (such as `tu` or `vous`). It also lists the AI translations already added, marked `"AI"`, so new terms stay consistent across batches. When the existing translations and the glossary disagree, follow the existing translations, since users see them side by side; the glossary is for terms not translated yet. Follow the existing terminology, not its mistakes: write correct punctuation and grammar even where some existing strings don't.
- **Placeholders**: keep every printf placeholder (`%s`, `%d`, `%1$s`) exactly as written. Only numbered ones such as `%1$s` may change order.
- **Markup**: keep tags such as `<a>`, `</a>`, `<strong/>` or `<learnMoreLink>` exactly as written, and translate the text between them.
- **Plurals**: a string with a `plural` needs one form per plural form of the language, in the order of `pluralForms`. Any other string needs exactly one form, even with a `%d`: phrase it so it reads right for any number. A form may spell out the count where the language says "one site" rather than "1 site", but the last form keeps the English plural's placeholders. When the string holds more than one number ("%1$d of %2$d site"), open its file to see which one the code passes to `_n()`: the form follows that number, so the noun must agree with it, or use a label that reads right for any number ("Sites: %1$d of %2$d").
- `context` says what a short string means, and `note` is the developers' note to translators, such as what each placeholder holds. When a note says a string fills the `%s` of other strings (a post type in "Create %s"), translate it in the form those strings need, such as the case their verb takes.
- Leave code, commands (`studio auth login`), file names and URLs as they are, and product names (WordPress, WordPress.com, Studio, Blueprint) the way the existing translations treat them.
- A translation identical to the English is fine where nothing changes: key names (`Esc`), units (`%d B`), names. The suggested site names (jazz titles such as "Take Five", from `packages/common/lib/site-names.ts`) follow how the locale already treats "Hello Dolly": kept in English, or written in the language's script.
- For search keywords (such as "publish site sync push pull upload download"), write the keywords in the language and keep the English ones, so searching in English still works.
- Write natural, concise interface text in the language, rather than a word-for-word rendering of the English.

`add` already rejects a translation with missing or extra placeholders or markup, or the wrong number of forms, so what needs care is the meaning and the terminology.

## Finish

1. `T merge` should report the strings left in English as 0 for every locale, apart from any you could not translate.
2. Commit `packages/common/translations` (the `ai/` files and the `.jed.json` files) and open the PR into `release/<version>`. In the PR, list the locales and the number of strings each got, so reviewers who read a language know where to look, and the mistakes you found in existing translations (a wrong meaning, a translated command), so translators can fix them in GlotPress.
