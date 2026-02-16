# Localization

Text is translated using [GlotPress](https://translate.wordpress.com) but the
process of getting original strings into GlotPress and the translations back
into the app is somewhat manual at the moment.

## Supported Languages

We currently support the magnificent 16 languages defined in `common/lib/locale.ts`, 
as well as Polish, Vietnamese and Ukrainian.
If you want to add support for another language you will need to add it to the
`supportedLocales` array.

## Translation Process

### Extract and Import

String extraction and GlotPress import are automated as part of the release process:

1. During **code freeze**, the `code_freeze` Fastlane lane extracts all translatable strings
   and commits the resulting `i18n/bundle-strings.pot` file to trunk.
2. A **wpcom cron job** (`import-github-originals.php`) periodically fetches the `.pot` file
   from trunk and imports it into [GlotPress](https://translate.wordpress.com/projects/studio/).

No manual steps are needed for string extraction or import.

### Export and Add

#### Step 1: Export from GlotPress:

We will export the translations as Jed-formatted JSON, which is a format
`@wordpress/i18n` can understand. It's ok if some translations are missing,
they will be left as English in the app.

   1. Open [our project in GlotPress](https://translate.wordpress.com/projects/studio/).
   2. Click the **Project actions** menu.
   3. Click **Bulk Export**.
   4. Click **Select WP.Com Priority Languages** to only the magnificent 16 languages.
   5. Select **Polish**, **Vietnamese**, **Ukrainian** and **Hungarian** too.
   6. Change the format to `Jed 1.x (.json)`.
   7. Leave the other fields as default and click **Export**.

#### Step 2: Add Translations to Project:
   1. Unzip the exported strings and add them to the `common/translations`. Overwrite
   the files in there with your new files.
