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
