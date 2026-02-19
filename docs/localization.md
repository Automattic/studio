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

#### Step 1: Extract Strings:

   1. Run `npm run make-pot` to get the text out of the source files.

   This will remove the `out/pots/` directory and create a `*.pot` file for each module, as well as a bundle
   of all translatable strings in `out/pots/bundle-strings.pot`.
   It will also open the import page in your browser and select the `bundle-strings.pot` file.

#### Step 2: Import to GlotPress:

   1. Drag and drop the `out/pots/bundle-strings.pot` to the file input in the GlotPress Studio page https://translate.wordpress.com/projects/studio/import-originals/
   2. Leave the format as "_Auto Detect_".
   3. Click **Import** and wait for the import to complete.

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
