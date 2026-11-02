---
name: curate-admin
description: Curate a site's wp-admin for the people who run it — decide which menu items stay, add post types for repeated content, surface global settings, and choose the dashboard widgets. Use it to simplify or lock down the backend, prepare a site for handoff to a client, white-label it, or limit what a client can change. Asks whether this is for a staff account or everyone, walks through the menu, post types, settings and dashboard, then installs and verifies it.
user-invokable: true
---

# Curate Admin

Curate wp-admin for the people who run this site, so it stays the normal wp-admin with only what they need in it. Use WordPress's own features: the admin menu, post types, taxonomies, block templates, the Settings API and dashboard widgets. A manifest drives a maintained plugin, so everything here goes through the manifest.

It works one of two ways, and the first question decides which:

- **A staff account:** a separate login and role see the curated version, and the user's own admin login keeps everything. Whatever leaves their menu is closed to them too. The account and role are called Staff unless the site's own words call for another name, such as "Team".
- **Everyone:** wp-admin itself changes for everyone who logs in. This only changes what people see: there is no Staff account or role, and administrators reach everything with **Full admin** in the toolbar.

Follow these steps in order. Nothing on the site changes until step 7 is done.

Take steps 3 to 6 one at a time, so the user validates each before seeing the next. Each step is its own message: propose that step whole, with your reasoning in the site's own words, then call AskUserQuestion to confirm it and settle any detail the site doesn't. Put your recommendation first and mark it "(Recommended)". Leave out a question the request already answers, and skip a step that has nothing to decide, saying so in a sentence. Without AskUserQuestion, ask in your text output and wait for the reply.

## 1. Read the site

Work on the one site the request is about, and start it with site_start if it is not running. Read it before asking anything:

- `inspect_wp_admin`, for every menu item, submenu and dashboard widget the site really has.
- `wp plugin list --status=active`, `wp post-type list`, `wp taxonomy list`, and the pages with `wp post list --post_type=page --fields=ID,post_name,post_title`.
- How much is in use: `wp post list --format=count`, `wp comment list --format=count`.
- `DESIGN.md` when the Active site section names one, and the content of the main pages with `wp post get`.

Work out what this site is for and what its people do on it in a normal week.

## 2. Who it's for

Ask this first, on its own: "Should this be a separate staff login, or should wp-admin change for everyone?" Offer "A staff account" ("A separate login sees the curated version, and your admin login keeps everything.") and "Everyone" ("wp-admin itself changes for everyone who logs in. Administrators can switch to Full admin from the toolbar."). Recommend a staff account when the site is being handed to someone else, and "Everyone" when the user runs the site themself. From here on, with "Everyone", say "you" where this skill says "staff".

## 3. The menu

This is the heart of the skill: every item `inspect_wp_admin` returned either stays or goes.

**Keep what this site's content needs.** A blog keeps Posts with all its taxonomies, Media, Comments, and any contact form entries. Keep anything visitors send in, such as form entries, orders and bookings, because someone has to read it. When that lives in a plugin's submenu, keep the submenu item and set `promote` so it reaches the top level. Dashboard and Profile always stay.

**Hide what is technical** on most sites: Plugins, Appearance, Tools, Settings, Users, and the settings screens plugins add. Hide what the site doesn't use, such as Posts on a site with none, or Comments when they are off. Don't hide something the site clearly depends on: a shop keeps its orders and products.

**Pages** get their own question when the site has pages:

- **Manage them:** staff add and edit pages freely.
- **Text and photos only:** staff can change what is on a page, but not its layout, and can't add or delete pages. Add `only` to limit this to some pages.
- **Hide them:** pages stay with whoever built the site.

Recommend managing them when the user will run the site, and text and photos only when the design should survive a handover.

A staff role can't reach the Site Editor, so Navigation stays with administrators. Say so if the site's menu links are likely to change.

## 4. Post types

Look for content repeated by hand in pages, that someone will want to add to: a restaurant's dishes, a portfolio's projects, testimonials, team members, services, events. Those are only examples, so go by what is on this site. Content that fits in a page or a post doesn't need a post type, and a blog usually needs none.

For each post type, propose:

- **Its structure.** Say what becomes the title, what becomes the content, and which fields it needs. Media means the featured image (`thumbnail` in `supports`). Categories mean a taxonomy. Reuse an existing taxonomy when it fits. Keep separate fields to what the design shows on its own, such as a price or a date.
- **How it is edited.** Long content keeps the editor, with `blocks` to limit it when that helps. Fixed items get a `template` with `templateLock`, so each one comes out the same. Fields without a template lock to `contentOnly` on their own.
- **Its URLs.** Set `public` when each item deserves its own page, with `urlSlug`, and `hasArchive` for a list page. When the item only appears inside other pages, leave `public` off and set `previewPath` to the page that shows it.
- **How it shows on the site.** Say which pages become Query Loops and Terms Query blocks instead of hardcoded content. Every item must come from the query.

## 5. Global settings

Look for single values that appear in several places or in the header and footer: phone, address, opening hours, a notice banner. A setting page is worth it when changing the value by hand means finding every copy. A value that lives in one place stays in that page, and a site's title and tagline stay in Core's own settings. Group related values on one page, which is an ordinary Settings API page saved through `options.php`.

## 6. Dashboard

Go through the widgets `inspect_wp_admin` returned and say which stay and why. At a Glance and Activity suit a site with regular posts and comments. WordPress Events and News, Site Health and the welcome panel rarely help someone running a site day to day. Quick Draft helps someone who jots posts.

Add a custom widget only when it answers a question people open the dashboard for:

- `recent`: the latest of a post type, such as form entries.
- `links`: shortcuts to what they do most.
- `requests`: a form that asks the agency for a change. Use it only when there is an agency.

## 7. Write the plan

Write this summary in your text output, under the heading **Admin Plan**, before you change anything:

- **Who it's for:** a Staff account, or everyone who logs in.
- **The menu:** what stays, what goes, and how pages work.
- **Post types:** each one with its structure and URLs, and what moves out of pages.
- **Settings:** each page and its fields.
- **Dashboard:** what stays, what goes, and any custom widgets.
- **Extras:** only what the user asked for.

Then carry on straight away: the questions were the approval. When the user says "just do it" or asks to skip the questions, use your recommendations and still write the plan.

## 8. Write the manifest

```json
{
  "audience": "staff",
  "menu": {
    "keep": [
      { "screen": "edit.php" },
      { "screen": "upload.php" },
      { "screen": "edit-comments.php" },
      { "screen": "edit.php?post_type=page", "lock": "contentOnly", "only": [ "home", "about" ] },
      { "screen": "admin.php?page=jetpack-forms", "promote": true, "label": "Messages", "icon": "dashicons-email" }
    ]
  },
  "postTypes": [
    {
      "slug": "dish", "singular": "Dish", "plural": "Dishes", "titleLabel": "Dish name", "icon": "dashicons-food",
      "supports": [ "title", "editor", "thumbnail" ],
      "previewPath": "/menu/",
      "taxonomies": [ { "slug": "menu_section", "singular": "Section", "plural": "Sections", "terms": [ "Starters", "Mains", "Desserts" ] } ],
      "fields": [
        { "key": "description", "label": "Description", "type": "textarea" },
        { "key": "price", "label": "Price", "type": "text" }
      ]
    },
    {
      "slug": "event", "singular": "Event", "plural": "Events", "icon": "dashicons-calendar-alt",
      "public": true, "hasArchive": true, "urlSlug": "events",
      "supports": [ "title", "editor", "thumbnail" ],
      "blocks": [ "core/paragraph", "core/heading", "core/list", "core/list-item", "core/image" ],
      "fields": [ { "key": "starts_on", "label": "Date", "type": "date" } ],
      "templateLock": false,
      "order": { "field": "starts_on", "direction": "asc", "upcoming": true }
    }
  ],
  "settings": [
    {
      "id": "hours", "title": "Opening hours", "icon": "dashicons-clock", "option": "fern_hours", "previewPath": "/contact/",
      "fields": [ { "key": "weekdays", "label": "Monday to Friday", "type": "text" } ]
    }
  ],
  "dashboard": {
    "keep": [ "dashboard_right_now", "dashboard_activity" ],
    "widgets": [ { "id": "messages", "type": "recent", "title": "Latest messages", "postType": "feedback" } ]
  }
}
```

- `audience` is the answer to step 2. With `staff`, `menu.keep` lists what stays, and items that appear later stay hidden. With `everyone`, `menu.hide` is a plain list of screens to remove, and items that appear later still show up. `menu.keep` can still rename or `promote` items with `everyone`, and it carries the page choice there too.
- Screens come from `inspect_wp_admin`, exactly as it returned them. A kept item keeps its submenus, such as Categories and Tags, unless `hideChildren` lists them. Post types and settings pages stay on their own, so they aren't listed.
- Leave the Pages item out for "Hide them", and give it no `lock` for "Manage them".
- `dashboard.keep` lists widgets to keep with `staff`, and `dashboard.hide` widgets to hide with `everyone`. Set `welcome` to true to keep the welcome panel.
- A post type with `fields` or a `template` keeps `editor` in `supports`, because that is where they are edited.
- `order` sorts Query Loops of that post type by a field, and `upcoming` leaves out past dates.
- `role.extends` is `editor` by default, or `author`, `contributor` or `shop_manager` for WooCommerce. `role.add` grants what a plugin's screen needs, and dangerous capabilities are stripped whatever the manifest says. To name the account differently, set `role.slug`, `role.name` and `client.name`.
- With a staff account, keep Custom HTML blocks off pages staff edit: their saves strip raw HTML, so it belongs in a template part.
- Write every label in the site's language.

These are extras, for when the user asks: `label` and `icon` on a menu item, `guide` (Help tabs: `{ "id", "title", "screen", "steps" }`, whose captures are public files, so point `screen` at nothing with customers' details), `brand` (`{}` fills it from `DESIGN.md`, for the login page and admin colors), `agency` (`{ "name", "email", "responseTime" }`, which turns on change requests), and `editor` (`blocks` limits every post's blocks, and `restrict` removes custom colors, sizes and code editing).

## 9. Install it

Call `install_client_admin`. When its result says the site isn't in English, translate the strings it lists into `strings` and call it again.

## 10. Build the site side

Do this only for what the plan moves, because it changes pages the design depends on. For each post type or setting that replaces content already written into a page:

1. take_screenshot the page and keep it as the reference.
2. Create each item with `wp post create --post_type=<type> --post_status=publish --menu_order=<position> --post_title=…`, then `wp post meta update` for its fields, `wp post term set` for its terms and `wp media import … --featured_image --post_id=<id>` for its photo, one command per wp_cli call. Keep the page's order. A post type's fields fill its content themselves. With a custom `template`, pass the template's block markup as `--post_content`.
3. Replace the static markup with a Query Loop that keeps the same wrapper blocks, classes and spacing, showing fields with Block Bindings, and use a Terms Query block for lists of categories. Load the `block-content` skill first and run validate_blocks on the result:

```html
<!-- wp:query {"queryId":1,"query":{"postType":"dish","perPage":100,"order":"asc","orderBy":"menu_order","inherit":false}} -->
<div class="wp-block-query"><!-- wp:post-template -->
<!-- wp:post-featured-image /-->
<!-- wp:post-title {"level":3} /-->
<!-- wp:paragraph {"metadata":{"bindings":{"content":{"source":"core/post-meta","args":{"key":"price"}}}}} --><p></p><!-- /wp:paragraph -->
<!-- /wp:post-template --></div>
<!-- /wp:query -->
```

4. A date field shows in the site's date format with `{"source":"client-admin/date","args":{"key":"starts_on"}}`.
5. Show a settings value anywhere, including template parts, with the `client-admin/setting` source, and write the current value into the option first with `wp option update <option> '{"weekdays":"12:00 to 22:00"}' --format=json`:

```html
<!-- wp:paragraph {"metadata":{"bindings":{"content":{"source":"client-admin/setting","args":{"setting":"hours","key":"weekdays"}}}}} --><p></p><!-- /wp:paragraph -->
```

6. For a public post type, write its layouts as block templates, so they don't depend on the theme: `single-<slug>.html` and `archive-<slug>.html` in the `templates` folder of the `client-admin-site` plugin. The active theme's own templates of the same name take priority.
7. take_screenshot the page again and compare it with the reference. The two must match. If you can't get them to match, put the old markup back, leave that content in the page, and tell the user.

## 11. Verify it

Call `verify_client_admin`. It signs in, opens every link in the menu, adds an item of each post type, saves each settings page, and confirms the results reach the site. With a staff account, it signs in as that account and confirms that hidden screens, plugins, themes, users and settings stay closed. With "Everyone", it confirms administrators can still reach them. When every check passes, Studio shows the user a button to open it at the end of your reply. Fix every failure in the manifest or the page, install again, and verify again until all checks pass. Look at the dashboard it returns too: an empty dashboard or a confusing label is a defect.

A failed check about something staff need is yours to fix. A screen or request that is reachable and shouldn't be is a security problem: never hand over a site with one.

## 12. Hand over

Tell the user:

- What the menu now offers, and what left it.
- With a staff account, that **Client admin** is next to WordPress Admin in Studio. With "Everyone", that WordPress Admin itself shows the new version, and **Full admin** in the toolbar brings everything back.
- Which content moved, and that the pages matched.
- The results of the checks, as a count and anything you changed because of them.

Publishing is a separate request. Mention that the site's hosting must allow plugins, loading the `hosting-plans-helper` skill before saying which WordPress.com plans do. With a staff account, that account stays on this computer, because Studio never pushes users. On the live site, the user creates staff accounts from **Users**, choosing the Staff role.

When the site changes later, run `inspect_wp_admin` again, update the manifest and repeat from step 9.
