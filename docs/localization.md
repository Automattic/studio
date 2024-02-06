# Localization

Text is translated using [GlotPress](https://translate.wordpress.com) but the
process of getting original strings into GlotPress and the translations back
into the app is somewhat manual at the moment.

## Supported Languages

We currently support the magnificent 16 languages defined in `src/lib/locale.ts`.
If you want to add support for another language you will need to add it to the
`supportedLocales` array.

## Translation Process

1. **Extract Strings**
   Run `npm run make-pot` to get the text out of the source
   files. This will create a `*.pot` file for each module, as well as a bundle
   of all translatable strings in `out/pots/bundle-strings.pot`.

2. **GlotPress Import**
   1. Open [our project in GlotPress](https://translate.wordpress.com/projects/local-environment/).
   2. Click the **Project actions** menu.
   3. Click **Import Originals**.
   4. Import `out/pots/bundle-strings.pot` (auto-detecting the file format is fine).

3. **Export Translations**
   We will export the translations as Jed-formatted JSON, which is a format
   `@wordpress/i18n` can understand. It's ok if some translations are missing,
   they will be left as English in the app.
   1. Open [our project in GlotPress](https://translate.wordpress.com/projects/local-environment/).
   2. Click the **Project actions** menu.
   3. Click **Bulk Export**.
   4. Click **Select WP.Com Priority Languages** to only the magnificent 16 languages.
   5. Change the format to `Jed 1.x (.json)`.
   6. Leave the other fields as default and click **Export**.

4. **Add to Project**
   Unzip the exported strings and add them to the `src/translations`. Overwrite
   the files in there with your new files.
