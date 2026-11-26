# Localization

Text is translated using [GlotPress](https://translate.wordpress.com/projects/studio/).
The process of getting original strings into GlotPress and the translations back
into the app is fully automated as part of the release process.

## Supported Languages

The set of supported languages is defined by `supportedLocaleNames` in
`packages/common/lib/locale.ts`. To add a new language:

1. Add a `studio-<locale>.jed.json` file in `packages/common/translations/`.
2. Import it and register it in `localeDataDictionary` in
   `packages/common/translations/index.ts`.
3. Add a `supportedLocaleNames` entry (its display name) in
   `packages/common/lib/locale.ts`.

The `supportedLocales` array is derived automatically from `supportedLocaleNames`,
so it does not need to be edited by hand.

The `<locale>` slug must match the language's slug in the
[Studio GlotPress project](https://translate.wordpress.com/projects/studio/) — the
automated export (see below) downloads from `…/<locale>/default/export-translations/`
and fails if that locale does not exist there.

## Translation Process

### Extract and Import (automated)

1. During **code freeze**, the `code_freeze` Fastlane lane extracts all translatable strings
   and commits the resulting `i18n/bundle-strings.pot` file to the release branch.
2. A **wpcom cron job** (`import-github-originals.php`) periodically fetches the `.pot` file
   from trunk (via the backmerge PR) and imports it into [GlotPress](https://translate.wordpress.com/projects/studio/).

No manual steps are needed for string extraction or import.

### Export and Add (automated)

During each **beta release**, the `new_beta_release` Fastlane lane downloads translations
from GlotPress in Jed 1.x JSON format (which `@wordpress/i18n` understands) and commits
them directly to the release branch before bumping the version. It's ok if some translations
are missing — they will be left as English in the app.

The lane discovers locales by globbing the existing `studio-*.jed.json` files in
`packages/common/translations/` (e.g. `studio-ckb.jed.json` → `ckb`) and downloads each
one from GlotPress. There is no separate allowlist — adding a translation file is what
opts a locale into the automated download.

No manual steps are needed for translation export. The standalone `fetch_glotpress_translations`
lane can be used to manually download translations if needed.

### AI translations for missing strings (release author)

Strings GlotPress has no translation for yet would ship in English, so at **code freeze** the
release author has an agent translate them, following
[`scripts/ai-translations/SKILL.md`](../scripts/ai-translations/SKILL.md): ask it to translate
the missing strings on the new `release/<version>` branch, and merge the PR it opens into that
branch before the first beta.

- The agent works from the frozen `i18n/bundle-strings.pot`, so the translations match the code
  that ships. It reuses each locale's existing translations and the Studio GlotPress glossary for
  terminology, and `scripts/ai-translations/index.mjs add` rejects any translation that changes the
  English string's placeholders or markup or has the wrong number of plural forms.
- The AI translations are committed to `packages/common/translations/ai/studio-<locale>.json` and
  merged into the shipped `studio-<locale>.jed.json` files. GlotPress translations always win.
- Every later download (each beta and the final release) merges them again on top of the fresh
  GlotPress files, and drops the ones GlotPress now translates or whose string left the code.
