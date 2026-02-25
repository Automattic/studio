# Localization

Text is translated using [GlotPress](https://translate.wordpress.com/projects/studio/).
The process of getting original strings into GlotPress and the translations back
into the app is fully automated as part of the release process.

## Supported Languages

We currently support the magnificent 16 languages defined in `common/lib/locale.ts`,
as well as Polish, Vietnamese, Ukrainian and Hungarian.
If you want to add support for another language you will need to add it to the
`supportedLocales` array and add a corresponding `studio-<locale>.jed.json` file
in `tools/common/translations/`.

## Translation Process

### Extract and Import (automated)

1. During **code freeze**, the `code_freeze` Fastlane lane extracts all translatable strings
   and commits the resulting `i18n/bundle-strings.pot` file to the release branch.
2. A **wpcom cron job** (`import-github-originals.php`) periodically fetches the `.pot` file
   from trunk (via the backmerge PR) and imports it into [GlotPress](https://translate.wordpress.com/projects/studio/).

No manual steps are needed for string extraction or import.

### Export and Add (automated)

During **pre-release**, the `download_translations` Fastlane lane downloads translations
from GlotPress in Jed 1.x JSON format (which `@wordpress/i18n` understands) and creates
a PR to merge them into the release branch. It's ok if some translations are missing —
they will be left as English in the app.

The lane discovers locales from the existing `studio-*.jed.json` files in
`tools/common/translations/` and downloads each one from GlotPress.

No manual steps are needed for translation export.
