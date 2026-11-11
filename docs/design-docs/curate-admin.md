# Curate admin

The `curate-admin` skill curates wp-admin for the people who run a site. It stays the normal wp-admin with only what they need in it, built on Core's own features, and keeps running on the site with no dependency on Studio. There is no separate app, and no task layer on top of WordPress.

The skill works through four decisions, in this order:

1. **The menu.** Which items stay and which go. This is the main job: a blog keeps Posts, its taxonomies, Comments and form entries, and hides what is technical.
2. **Post types.** Whether repeated content needs one, and for each one its structure, editing, URLs and how the site queries it.
3. **Global settings.** Whether single values need a settings page.
4. **The dashboard.** Which widgets stay, and whether a custom one earns its place.

## The pieces

| Piece | Where | Role |
| --- | --- | --- |
| Skill | `packages/agent/shared/skills/curate-admin/SKILL.md` | The runbook: read the site, walk through the four decisions, write the plan and manifest, build the site side, verify, hand over |
| `inspect_wp_admin` | `packages/agent/node/tools` | Reads the real menu, submenus and dashboard widgets as an administrator sees them. WP-CLI never builds the menu, so this takes a page load |
| `install_curated_admin` | `packages/agent/node/tools` | Validates a manifest, copies the runtime, writes the site plugin, creates the Staff account |
| `verify_curated_admin` | `packages/agent/node/tools` | Signs in, opens every menu link, adds an item of each post type, saves each setting, and proves what must stay closed does |
| Runtime plugin | `packages/agent/shared/skills/curate-admin/plugin` (`wp-content/plugins/curate-admin`) | Reads the manifest. Generic: holds no site data, and has no build step |
| Site plugin | Generated (`wp-content/plugins/curate-admin-site`) | Holds `curate-admin.json`, `guide/` and `templates/` for this site |
| Staff admin | `getStaffAdminLogin` in `packages/common/lib/curate-admin.ts`, read by `getSiteDetails` | Tells Studio which account to open, and hides the links on other sites |

## What it maps to in WordPress

| Manifest | Core API |
| --- | --- |
| `menu` | `$menu` and `$submenu`, after every plugin has added its items |
| `role` | A custom role, kept in line with the manifest on every load |
| `postTypes` | `register_post_type`, `register_taxonomy`, `register_post_meta`, on the normal list screens |
| Item editing | The block editor, with a post type `template` and `template_lock`, `allowed_block_types_all`, and paragraphs bound to post meta |
| Item layouts | `register_block_template`, from `templates/` in the site plugin |
| Showing content | Query Loops, Terms Query and Block Bindings (`core/post-meta`, `curate-admin/setting`, `curate-admin/date`) |
| `order` | `query_loop_block_query_vars`, since a Query Loop has no meta sort or date filter |
| `settings` | Settings API pages, with `option_page_capability_{$page}` so Staff can save them |
| `dashboard` | `wp_dashboard_setup`, `wp_add_dashboard_widget` |
| `guide` | Help tabs, with captures from verification |
| `brand` | An admin color scheme (`wp_admin_css_color`) and the login hooks |
| `agency` | Change requests: a private post type, read on a normal list by administrators |

Everything after `dashboard` in that table is optional, and nothing turns on unless the manifest asks. A site with no `brand` keeps wp-admin's colors.

## Principles

**A manifest, not generated code.** The agent writes data, and one tested plugin reads it. The curation logic has to stay the same on every site, and validation catches mistakes before they reach one.

**The site owns the result.** Everything is a regular plugin on the site, so it survives a push, an export or a move to another host. Regular plugins, not mu-plugins: `studio push`'s options have no mu-plugin selection, and hosts treat them differently.

**Stay close to Core.** Each post type maps almost one to one onto `register_post_type`, and a kept menu item keeps its submenus and its own screens. Custom code only fills gaps Core leaves, such as a date field and a sorted Query Loop.

**Capabilities are the security boundary.** For Staff, hiding a menu item that has a capability also removes it: Comments takes `moderate_comments`, Pages takes the page capabilities. The screen allowlist then stops deep links, and `role.php` strips dangerous capabilities whatever the manifest says, because `shop_manager` grants some of them. `verify_curated_admin` tests the REST API as well as the screens.

## Two audiences

The skill's first question sets `audience`. **Staff** is a separate account and role. Capabilities and a screen allowlist limit it, and Studio shows Staff admin. **Everyone** curates wp-admin itself for all who log in: there is no role or account, nothing is limited, and Studio shows no Staff admin. `curate_admin_is_staff()` decides what is enforced, and `curate_admin_is_curated()` decides what people see.

The two store the menu differently. Staff save a keep list, so a plugin added later stays hidden from them. Everyone saves a hide list, so a plugin added later still shows up. Dashboard widgets work the same way.

With everyone curated, an administrator would otherwise lose Plugins and Settings from the menu, so **Full admin** in the toolbar turns the curation off for that user. It's a per-user view setting, not a security control.

When verification passes, it emits an `admin-link` chat artifact, the same mechanism as the design system's. The conversation shows it once, after the closing message, as Open staff admin or Open wp-admin.

## Staff admin

The install tool creates a local Staff account with a random password. Studio opens it through `/studio-auto-login?user=<login>`, next to WordPress Admin in the Tools menu, Open in, the command palette and the preview's address bar. Sites without a manifest show none of these. `/studio-auto-login` is local to Studio and already signs in as the admin without a password. With no `user`, it replaces a session that can't `manage_options`, so WordPress Admin never opens as Staff.

The preview can't tell the Staff session from its URL, because `/wp-admin/` is the same for every account. `usePreviewSurfaces` records it from the sign-in hop instead, and it holds until a hop signs in as the admin.

**This account stays local.** The exporter skips `wp_users` and `wp_usermeta`, and `studio push` uses it, so no local user reaches a live site. On the live site, the agency creates staff from **Users** with the role, which the plugin creates there.

## Decisions worth knowing

**A top-level item goes by two screens.** WordPress links a menu item to its first submenu, so a plugin's `Forms` can report `edit.php?post_type=form_entry`. `curate_admin_item_screens` matches both.

**`promote` moves a submenu item to the top level.** Form entries usually sit under a plugin's menu whose parent needs `manage_options`. Core answers a nested post type with a 403 for an Editor in that case, even with this plugin off, and promoting it fixes that.

**Core escapes `&` in taxonomy submenu links.** `curate_admin_menu_screen` decodes them, or the allowlist reads `amp;post_type`.

**Item templates are seeded.** The editor applies a post type's template only to new posts, so `wp_insert_post_data` fills in the fields' template for items created over WP-CLI or REST. A custom `template` has markup only the agent knows, so it passes that itself.

**Text and photos only needs two parts.** A root `templateLock: 'contentOnly'` leaves top-level blocks removable, and `templateLock: 'all'` alone leaves their styles editable. So PHP sets `all`, and `assets/editor.js` sets each block's editing mode: `contentOnly` for blocks with content attributes, `disabled` for the rest. This protects a design from accidents, not from someone crafting their own REST request.

**Limited or locked pages can't be added.** `register_post_type_args` sets `create_posts` to `do_not_allow` for Staff, which covers the Add links, `post-new.php` and REST together. `map_meta_cap` closes pages outside `only` and stops locked pages being deleted.

**`publish_pages` stays.** Without it, the editor turns saving a live page into "Submit for Review", which takes the page offline. The manifest schema refuses to remove it while Pages is kept.

**Post types with no URLs are still `publicly_queryable`.** Query Loops only show viewable post types. `rewrite` and `query_var` are off, and a direct item URL redirects to `previewPath`.

**`$submenu` stays whole.** WordPress checks plugin screens against it, and it is what keeps Categories and Tags under Posts.

**A bare `edit.php` isn't allowed.** It would match every post type, so the allowlist always names one, and `post.php` follows the item's own list.

**`options.php` opens for Staff only to save.** Without `action=update` it lists every option on the site, so `option_page_capability_{$page}` grants `read` for saving alone.

**Limited pages hold their status and URL.** Quick Edit and bulk edit set a page's status with only `edit_post`, and trashing renames it, which would put it outside `only` for good. `wp_insert_post_data` restores the status, slug, parent and password for Staff, reading the old slug from `_wp_desired_post_slug` because core renames a trashed post before that filter.

**Closing "add new" is resolved per user.** `register_post_type_args` points `create_posts` at a capability of ours, and `map_meta_cap` answers it, because application passwords and XML-RPC sign in after core registers its post types.

**The allowlist reads a request the way core does.** Core takes `page` and `post` from the URL alone, `post_type` and `taxonomy` from either place, and `post_ID` from the body. So `post` and `page` in a body are ignored, and the rest must pass with the URL winning and with the body winning. Term edits post to a bare `edit-tags.php`.

**The manifest only runs post types it creates.** Its template, lock and URL redirect would break another plugin's type, so the install tool refuses one that already exists. Those stay as kept menu items.

**The verifier opens every menu link.** This is how a too-narrow role shows up, because a kept item and the screen behind it can disagree. Only landing on the dashboard counts as refused, since plugins redirect between their own screens.

## Limits

- A Staff role can't reach the Site Editor, so Navigation stays with administrators. It sits behind `edit_theme_options`, which also opens templates and styles.
- Post types share `edit_posts`, so hiding Posts closes adding and editing posts through their own rules rather than by removing the capability. A Query Loop over posts then previews empty for Staff in the editor, though the site shows it, and with Comments kept, Reply fails on comments of hidden posts and of pages outside `only`, though moderating them works.
- A plugin's post type on the default capabilities keeps working over REST when its menu item is hidden, and so do categories and tags while any post type has taxonomies. Only the screens close.
- Patterns' screens close, but a synced pattern stays editable over REST, because refusing `edit_post` breaks it in the editor.
- Hiding Media closes its screens but not uploading, which image blocks need.
- Staff can't save raw HTML, so `verify_curated_admin` fails on a Custom HTML block in a page they edit.
- `shop_manager` keeps `manage_woocommerce`, which also opens WooCommerce's settings over REST. Remove it with `role.remove` if staff shouldn't reach them.
- `curate-admin.json` and guide captures are public files in `wp-content/plugins`, so neither holds anything private.
- Items of a post type with no URLs are still public through REST, because they appear on the site anyway.
- Field types are text, long text and date. Core has no declarative field UI yet: bound paragraphs cover text, and a small sidebar panel covers dates.
- Sites need WordPress 6.9 or later.
- The runtime updates only when the skill runs again and the site is pushed. Automatic updates need it on WordPress.org.
