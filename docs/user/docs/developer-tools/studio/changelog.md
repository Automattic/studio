# WordPress Studio Changelog

WordPress Studio ships fast and often. This changelog highlights what’s new, what’s improved, and what’s been fixed in each release. While you can always [view technical release notes on GitHub](https://github.com/Automattic/studio/releases), this page gives you the bigger picture: how each update helps you build faster, safer, and smarter with WordPress.

## [1.24.0](#0-1-24-0)

-   Moved every site to native PHP:
    -   Sites that used the Sandbox runtime switch to native PHP automatically
    -   The Native/Sandbox choice is gone from site creation and settings
-   Studio MCP: Improved working with coding agents like Codex
    -   Agents now get Studio’s instructions and skills, and can work on both local and WordPress.com sites
    -   Added a clickable picker for choosing a site’s look and layout from rendered options
    -   Agents can generate site images with their own image tool
    -   Agents no longer ask for approval before each call that only reads or only changes this machine
    -   Added a **WordPress** tab to agent apps’ sidebars, listing your local Studio sites and WordPress.com sites
-   Studio Code
    -   One agent now handles both local and WordPress.com sites, so a single conversation can, for example, copy a live post into a local site
    -   Theme template edits now apply to Site Editor customizations instead of being silently ignored
-   Push, pull and connected sites
    -   Studio now warns before quitting while a push or pull is running
    -   A push or pull that can no longer be safely stopped finishes after Studio quits, and shows up again when Studio relaunches
    -   Connected sites show their current name, URL and sync status
    -   Connected sites that no longer exist are labeled, and their Pull and Push buttons are hidden
-   Site preview and links
    -   Links that open a new window, such as “View post” and the editor’s Preview, now open in the preview pane
    -   Links to other sites open in your system browser
    -   The site front end opens in your external browser without logging you into WP Admin
-   Other Fixes
    -   Saving site settings no longer overwrites the WordPress admin email
    -   Changing only the admin username now renames the admin user
    -   Changing the WordPress version now works on a site that has never been started
    -   Blueprint wp-cli steps now run on Windows
    -   Sites on a different Windows drive than Studio no longer fail because of open\_basedir
    -   Native PHP workers no longer crash under heavy CPU load
    -   .wpress backups from current All-in-One WP Migration versions import again
    -   Creating a site from a multisite Blueprint now requires a custom domain
    -   The agent instructions autosave no longer overwrites edits made elsewhere
    -   Preferences that fail to load show an error instead of loading forever
    -   Pressing Enter to confirm an IME candidate no longer sends the message
    -   Browser UI: Delete all preview sites now deletes them
-   Updated multiple dependencies
-   Misc and maintenance improvements

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.24.0)

*October 13, 2026*

## [1.23.0](#0-1-23-0)

-   Made the Agentic UI the only Studio UI, retiring Studio Classic
-   Added a Design system tab to the site preview
-   Kept every Studio window in sync with your sites: syncs, imports and preview updates now show up wherever they were started — in the Desktop app, the browser UI, the CLI or Studio Code — and sites no longer look busy after a quick operation
-   Blocked starting, stopping and other site actions while a sync, import or export is working on the site
-   Improved publishing: the site picker tells Pressable and WordPress.com sites apart, sites without a live site offer “Connect” instead of “Publish”, and the sync buttons show when a site was last pulled and pushed
-   Added full lists of your preview sites — with create, update, rename and delete — and of your connected live sites
-   Added a WP Admin entry to the Open in… menu, and let the browser UI show WP Admin and phpMyAdmin in the site preview
-   Brought chat attachments and generated images to the `studio ui` browser app
-   Improved preview annotations: each annotation is now its own chat message with the element’s context, and the annotation actions are clearer
-   Added a persistent offline indicator to the sidebar, logged sidebar cards in the notification history, and showed composer attachment and send errors as toasts
-   Studio Code: Images are now generated in the background while the build carries on, through the WordPress.com AI proxy, and imported into the media library
-   Studio Code: Moved the Balanced and Strong tiers to newer models
-   Studio Code: Made the agent ask its design questions unless your brief already names a design, and self-hosted the fonts picked in `DESIGN.md`
-   Studio Code: Improved the sites the agent builds — header and footer parts render as proper header and footer elements, sidebar and other side-by-side layouts no longer start with a gap, block spacing matches how WordPress renders it, and the visual polish pass sticks to real defects
-   Studio Code: Fixed parallel block validations logging each other out
-   Removed the Desks widget catalog and the `studio_present` tool
-   Fixed pushes failing after 10 minutes while the live site was still importing, and pushes to WordPress.com failing on MySQL 8-only collations
-   Fixed pulls of large sites hanging when started without a terminal
-   Showed a plain-language message when a backup import fails
-   Fixed exports and sync skipping every folder named `cache` instead of only `wp-content/cache`
-   `studio create --from` now accepts URLs, recreating the site through Data Liberation, and names imported sites after their captured title
-   Native PHP runtime: Added the SOAP extension, allowed slow Blueprint downloads, converted SQLite out of WAL mode on start, and kept PHP warnings out of WP-CLI output
-   Fixed sites running out of file descriptors while recovering from a PHP error
-   Redacted admin passwords from the default `studio list` JSON output
-   Fixed the titlebar menu and modal close button not responding on the Linux and Windows add-site screens, and kept headers clear of the window controls when the sidebar is collapsed
-   Kept the window draggable around the content frame and with the sidebar hidden, and aligned the macOS traffic lights with the preview toolbar in full preview
-   Restored PHP runtime controls in the create-site flow
-   Made new chats and sessions open faster by no longer scanning the whole session library
-   Formatted AI credit prices for your language
-   Polished menus, popovers, the Overview About card and the New Site flow
-   Updated the bundled PHP binaries
-   Updated multiple dependencies
-   Misc and maintenance improvements

## [1.22.0](#1-1-22-0)

-   Studio Code now lets you pick your site’s design before it builds: four looks, then four layouts previewed in the look you chose, each shown as a rendered sneak peek with real imagery. Your pick is saved as `DESIGN.md` at the site root, which later sessions and other coding agents follow
-   Replaced the WordPress.com model picker’s vendor names with three capability tiers — Fast, Balanced and Strong — so you choose by what you need rather than by model name
-   Added a “What should we create?” brief to site creation in the Agentic UI, which opens the new site’s chat with your brief already sent
-   Studio Code: You can now answer the agent’s questions by typing in the prompt box, and questions can accept multiple selections
-   AI credits: Added usage warnings at 80% and 90%, and a confirmation toast when you return from checkout
-   Reworked the signed-out Studio Code screen into a feature carousel with animated demos
-   Agentic UI: Restored the PHP runtime and file access settings, so switching a site between Native and Sandbox no longer needs Studio Classic or the CLI
-   Agentic UI: Rebuilt the site preview with a browser-style toolbar — an editable address field with recent addresses, and back, forward and refresh with right-click history menus
-   Agentic UI: Added a preview zoom option, and made Cmd/Ctrl +, − and 0 scale the interface even when the preview has focus
-   Agentic UI: Made sidebar notices legible at a glance and added a recent notifications dialog
-   Improved preview annotations: the page dims around the element you’re describing, the note can be dragged aside, and you can step through the elements stacked under your click
-   Agentic UI: Moved the sidebar toggle to a fixed spot in the chat panel instead of it jumping between the two
-   Added SCRIPT\_DEBUG and WP\_ENVIRONMENT\_TYPE toggles to a site’s Debugging settings
-   Fixed WordPress auto-updates being silently off on sites created before the setting existed, while Settings showed them as on
-   Fixed a site failing to start after renaming its admin user without setting a password
-   Fixed sites failing to boot when their SQLite database was left in WAL mode
-   Fixed site startup failing on Windows with an unexplained “PHP error during startup”
-   Fixed importing `.wpress` backups with entries of 2 GiB or more, and added clear errors for truncated archives
-   Added support for importing plain `.tar` backups, including archives whose extension no longer matches their contents
-   Fixed the “new way to build in Studio” nudge being unclickable on Windows
-   Fixed the Agentic UI opening the most recent chat scrolled to the top after a cold start
-   Fixed the sync dialog following the OS color scheme instead of the app’s Appearance setting
-   Fixed the Copy button on notices doing nothing in the Desktop app
-   Pointed the Antigravity editor option at Antigravity IDE, which had been non-functional since Google split the product
-   Fixed phpMyAdmin and wp-admin not auto-logging in from the sidebar’s site menu
-   Agentic UI: Fixed sidebar button alignment, footer spacing, and colors that ignored the Light/Dark setting
-   Studio Code: Made the agent build sites more reliably — theme templates are validated as they’re written, `validate_blocks` accepts site-relative paths and stops flagging valid SVG and script blocks, and blank themes scaffold without a stray parent
-   Studio Code: Made builds faster and cheaper by batching file edits per turn and sending smaller screenshots without breaking the prompt cache
-   Studio Code: Stopped asking whether to create a new site unless your prompt names a different one, and kept `take_screenshot` available to models that can’t see images
-   Studio Code: Cleared tool progress once a call ends and rotated the thinking label per step
-   Removed Dolly, the beta Telegram bridge for driving a `studio code` session from a chat app
-   Updated the bundled SQLite database integration to v3.0.2, and WordPress Playground and PHP-WASM to 3.1.53
-   Added Tracks analytics for the design options Studio Code proposes and which ones you pick
-   Updated multiple dependencies and resolved fixable Dependabot alerts
-   Misc and maintenance improvements

## [1.21.0](#2-1-21-0)

-   Made your AI credit balance visible wherever you work: a meter in both the Agentic and Classic composers, the remaining balance in the CLI’s end-of-turn stats line, and a new `/credits` command to check it and top up without leaving the terminal
-   Reworked the WordPress version setting: “latest” is now an “Automatic updates” toggle with a separate version picker, and it shows the version your site is actually running, so Settings and wp-admin no longer disagree. The CLI accepts `--wp auto-update` to match
-   Studio Code: Improved the sites the agent builds — a wider default content width with wide layouts for grids, proper padding on cards and full-width sections, and WooCommerce shop pages that clear the header and footer
-   Added a blueprints library to the Agentic UI
-   Agentic UI: The window can now shrink to 420px so Studio works as a compact companion beside your browser or editor, with the sidebar collapsing automatically at narrow widths
-   Agentic UI: Added a link to debug.log in site settings once the file exists, and preserved unsent chat drafts when switching between sites
-   Agentic UI: Fixed the publish flow suggesting an invalid WordPress.com domain based on your local `.wp.local` address
-   Added `studio create --from` to build a site from static sources — compiled artifacts, directories, zip archives, and Data Liberation captures
-   CLI: `studio delete` now accepts multiple sites in one command, running the whole batch through a single daemon session
-   Fixed a site delete leaving the site behind when moving its files to the trash failed
-   Fixed Studio reopening its window right after you closed it on nightly builds
-   Allowed selecting individual files in `pull-reprint` selections
-   Fixed 171 CLI strings never reaching translators because string extraction silently skipped files using `await using`
-   Added Tracks analytics for sync with WordPress.com and Pressable, and fixed Agentic UI pushes inflating the export event
-   Updated multiple dependencies, including Electron 44, the WordPress, Sentry and testing groups, and the release toolkit
-   Misc and maintenance improvements

## [1.20.0](#3-1-20-0)

-   Added AI image generation to Studio Code: the agent now creates real images while it builds a site, instead of leaving placeholders behind, guided by a new imagery skill
-   Improved the AI credits experience: the top-up dialog now offers four credit amounts, explains what credits are and how they differ from tokens, and links to the AI credits guidelines. A new usage meter in Settings → Usage shows how much you have left
-   Improved the Studio Code terminal UI: tools that run at the same time now report their own progress and results live, instead of piling up under the last tool call
-   Studio Code: Improved the sites the agent builds — anchor links in one-page site headers now point at the home page, pill labels stay inside the content column, and styling prefers the theme’s block styles over custom CSS
-   Fixed new sites being created in English instead of the language configured in Studio
-   Fixed being signed out of wp-admin every time a site restarted, such as after saving settings, changing the PHP version, or toggling Xdebug
-   Fixed the Publish button showing the previous user’s cached remote sites after signing out and back in
-   Agentic UI: Fixed settings alignment in some languages, a blurred scrollbar beneath conversations, the empty-state frost clipping at the panel edge, and the About card’s disk measurement thrashing when switching sites
-   Agentic UI: Simplified phpMyAdmin’s embedded interface, improved the working timer’s units and transition, and made the agent’s preview refresh drop the cache like the toolbar’s does
-   Data Liberation: Added timeouts to browser calls so extraction cannot hang, removed stub commands that shadowed their skills, and updated its dependencies
-   Updated multiple dependencies, including the ESLint and testing groups, RuboCop and claude-code-action
-   Misc and maintenance improvements

## [1.19.0](#4-1-19-0)

-   Introduced AI credits in Studio Code: you can now purchase AI credits for your sessions. Your remaining balance now shows in the composer, in Usage settings, and in Studio Classic settings. You get a clear message and a working top-up link when you run out, and the balance refreshes as soon as you return from topping up
-   Added hosted AI models — Kimi, GLM and DeepSeek — available through the WordPress.com proxy
-   Studio Code: Improved generated themes with a content width and horizontal gutter, a registered no-title page template so designed pages no longer repeat their title, and slideshow and gallery builds steered to Jetpack blocks
-   Misc Agentic UI improvements
-   Improved Studio analytics
-   Updated multiple dependencies, including Electron and the ESLint, Vite, testing and Ruby groups
-   Misc and maintenance improvements

## [1.18.0](#5-1-18-0)

-   Made the Agentic UI the default experience for new users, removed its feature flag, and added a Beta menu to the sidebar
-   Agentic UI: Reworked the new-user onboarding with a first-run orientation guide and a “What’s New” view
-   Agentic UI: Rebuilt the site preview with a new address bar and omnibox, live page and post search, responsive preview modes, and a full preview panel with Desktop + Mobile comparison
-   Agentic UI: Brought over the remaining site workflows from the classic UI — the site overview, backup import, Open in actions, connecting a WordPress.com site, selective sync, and cancelling an in-flight push or pull
-   Agentic UI: Added multi-note annotation sessions and support for your own Anthropic API key, selectable per conversation from the model menu
-   Agentic UI: Polished chat, settings and the create-site flow, improved RTL and reduced-transparency support, and fixed a range of preview, layout and interaction issues
-   Studio Code: Replaced Opus 4.8 with Opus 5, surfaced the payment-method requirement before the first prompt, and showed a clear notice when AI is disabled or the account is blocked
-   Studio Code: Fixed a 400 error when using a direct Anthropic API key, validated the key in the api-key and provider CLI commands, and sent a custom user agent on AI requests
-   Improved analytics across the app
-   Made site startup and creation more resilient: a site with a fatal PHP error now starts and shows the error, a failed Blueprint reports the real reason instead of the PHP exit code, and a failed creation no longer leaves a ghost site behind
-   Fixed sites getting into a broken state when two operations ran at once, such as starting a site while it was still stopping
-   Fixed a stuck Start/Stop indicator and the inverted play/pause glyphs on the site status toggle
-   Fixed site URLs not updating on native PHP imports and an ENAMETOOLONG error from open\_basedir, raised max\_execution\_time, and dropped Blueprint features the native runner cannot accept
-   Added Spotlight keywords for improved discoverability, and dropped the restart popup when an update is ready
-   Updated the bundled PHP binaries and the SQLite database integration to v3.0.0-rc.8
-   Updated multiple dependencies, including WP Playground, Electron and the pi (agent) packages, resolving several security alerts
-   Misc and maintenance improvements

## [1.17.0](#6-1-17-0)

-   Added support for importing WordPress export (WXR/.xml) files
-   Agentic UI: Redesigned application settings as an auto-saving fullscreen overlay with new tabs (Account, AI, MCP, Skills, Usage, Keyboard shortcuts, Studio CLI), plus a default site directory preference
-   Agentic UI: Added a site overview view, site creation from imports, suggested starter prompts, persistent update notifications, and an Xdebug indicator for Xdebug-enabled sites
-   Agentic UI: Improved continuity between sessions (returning to the last visited site, remembering the preview path per site) and defined the signed-out and offline experiences
-   Agentic UI: Separated the agentic features toggle from the classic UI switcher, and removed the theme toggle from the sidebar user menu
-   Agentic UI: Fixed expired previews, chat input resizing, preview button sizing, the collapsed sidebar overlapping the chat history icon, and made the WordPress version field a dropdown in site settings
-   Agentic UI: Brought over the Wapuu World easter egg
-   Studio Code: Added a global instructions config for the agent
-   Studio Code: Surfaced monthly AI usage limit errors across all surfaces
-   Studio Code: Made the agent aware of theme asset bundling
-   Deleted AI chat sessions when their site is deleted, continuing cleanup even if one session fails
-   CLI: Added aliases for the help, version and path commands, and made `studio ui` work in release builds
-   Hardened security: fixed path injection in path comparison, ReDoS in the mu-plugins loader, and HTML sanitization in AI tool result previews; restricted local imports to registered uploads and scoped CLI preview listings to the authenticated user
-   Updated multiple dependencies, including Electron, Sentry, tar and shell-quote, resolving security alerts for esbuild and brace-expansion
-   Misc and maintenance improvements

## [1.16.0](#7-1-16-0)

-   Studio Code: Added a button to copy the full assistant message
-   Studio Code: Added opportunity to paste an image anywhere in the view
-   Studio Code: Added a recovery action to the Session not found state
-   Studio Code: Refreshed the composer placeholder copy
-   Studio Code: Added support for creating new blank or child themes
-   Studio Code: Fixed showing an error when the max token limit is reached
-   Studio Code: Fixed AskUserQuestion to support multiline input
-   Studio Code: Replaced GPT 5.5 with GPT 5.6 Sol and routed OpenAI models through the Responses API
-   Studio Code: Fixed headless runs not exiting after the turn completed
-   Studio Code: Made data-liberation flows more reliable with consistent AI wording, bundled driver scripts so skills work as installed plugins, and fixed the data-liberation scripts
-   Fixed sites showing offline after import
-   Fixed plugin reinstall failure after deletion in the Sandbox runtime
-   Fixed the macOS Trust Certificate button being hidden for untrusted CAs
-   Fixed native PHP sites not picking up updated Studio mu-plugins
-   Disabled Jetpack Stats for local sites
-   Simplified the “What to do with running sites” dialog shown when quitting Studio
-   Improved CLI sync error messages for sites that can’t be synced
-   Added Linux to the bug report Platform field and split out Architecture
-   Misc and maintenance improvements

## [1.15.0](#8-1-15-0)

-   Fixed Xdebug not starting on a normal page load on the native PHP runtime
-   Added skipping dangling symlinks when archiving site content
-   Studio Code: Screenshots taken by the assistant now appear inline in the conversation, and the agent can capture pages in light or dark mode
-   Studio Code: Allowed editing your last message after interrupting the assistant
-   Studio Code: Improved the /liberate command for recreating sites from other platforms, including surfacing it when searching for “migrate”
-   Studio Code: Fixed the agent seeing running local sites as stopped when resuming a session, avoiding redundant site starts
-   Update native PHP binaries to latest versions to fix SQLite issue
-   Allowed more time for AI-powered plugins to receive a response before timing out
-   Improved an error message when a site is in maintenance mode
-   Improved CLI slash-command autocomplete with alphabetical sorting and match highlighting
-   Misc CLI and maintenance improvements

## [1.14.0](#9-1-14-0)

-   Fixed a fatal Windows issue where native PHP sites failed to run when the username was longer than 8 characters
-   Studio Code: Added a /liberate command to recreate sites from other platforms (e.g. Wix) as WordPress
-   Studio Code: Added a /publish command to push local sites to WordPress.com
-   Studio Code: Updated the assistant’s available model to Sonnet 5
-   Studio Code: Agent file edits now show as proper line-by-line diffs in the CLI and desktop assistant
-   Studio Code: Improved plugin recommendations for Automattic products, and tuned agent behavior for native PHP vs Playground sites
-   Studio Code: Fixed an unwanted gap in block themes scaffolded by the assistant
-   Fixed an issue where Pressable sites were marked unsupported on the Sync tab
-   Fixed recreating missing db.php drop-ins and preserving custom SQLite drop-ins
-   Fixed occasional failures when duplicating a site
-   Fixed broken Central Kurdish (Sorani) text on macOS by bundling the Vazirmatn font
-   Updated multiple dependencies, including WP Playground and PHP-WASM, the SQLite database integration, and the pi (agent) packages

## [1.13.0](#10-1-13-0)

-   Fixed PHP error (code: 3221225781) by updating native PHP packages to include necessary Windows DLLs
-   Added sidebar toggle keyboard shortcut (Cmd+B on macOS and Ctrl+B on Windows/Linux)
-   Differentiated preview sites from connected WordPress.com remote sites
-   Improved attachment handling in the Studio Code composer
-   Added copy button and selectable text to agent code blocks
-   Tweaked system prompt to mention database
-   Documented SQLite-to-MySQL migration path in STUDIO.md and publishing to supported hostings
-   Handle 413 push failures gracefully in Studio sync
-   Fixed transparent active state on attachment delete button in composer
-   Skip persisted tool\_progress entries during session replay
-   Added hosting-plans-helper skill for plan and pricing answers
-   Fixed Studio Code annotate closing message that always referenced the CLI
-   Removed noop menu items from topbar context menu

## [1.12.0](#11-1-12-0)

-   Introduced PHP runtime and File Access options, and improved the native PHP runtime: fixed WP-CLI tool calls, asset loading for sites with a remote site URL, and blueprint creation from read-only directories, and made pull-reprint work with native PHP
-   Improved Studio Code: content is checked before it is applied to your site, ecommerce sites are set up more reliably, and push/pull prompts are clearer. Tool calls are easier to follow with descriptions and a detail panel, remote sign-in shows a copyable login link, multiple-choice questions appear as clickable buttons, visual annotations install their browser automatically on first use, and available models were updated
-   Added assistant usage limits in Settings with clearer limit messaging, and made it clearer which settings apply to a site vs the whole app
-   Made the standalone Studio CLI easier to install and use: one-command install and updates from the web, a clean uninstall option, shorter commands for everyday site tasks, and new terminal commands to view and change site settings
-   Improved pull-reprint: choose a site from a searchable list when you have several connected sites, and re-running the command now syncs remote changes to your local copy
-   Added a Kurdish (Sorani) locale and improved locale handling
-   Renamed “Copy site” to “Duplicate site”
-   Improved performance and packaging: faster packaging builds, smaller installers, a higher PHP memory limit, and a cap on simultaneously running sites
-   Fixed dark mode across Studio Code dialogs, the site preview panel, and theming, and allowed conversation text to be selected and copied
-   Fixed a startup crash on Node.js 22, surfaced PHP errors when a site fails to start, resolved slow .local DNS on macOS, preserved in-progress messages in Studio Code, and restored the recorded model when resuming a session by id
-   Fixed tooltip delay so tooltips do not pop up instantly when moving the cursor
-   Clarified Sync and quit-sites messaging, and fixed What’s New modal copy
-   Updated multiple dependencies, including WP Playground, PHP-WASM, bundled PHP binaries, the SQLite database integration, and Reprint

## [1.11.0](#12-1-11-0)

-   Made Studio Code the default in the Studio app, replacing the previous Studio Assistant tab
-   Improved site status check for JSON format
-   Improved context for errors that bubble up from wordpress-server-child
-   Fixed multiple issues with the Dark theme for Studio Code
-   Fixed CLI symlink updates after Studio app update
-   Adjusted error display when backup status response is unexpected
-   Improved onboarding ToS/Privacy notices above the login CTA
-   Added one-time ToS/Privacy disclaimer in Studio CLI and Studio Code
-   Updated multiple dependencies, including WordPress packages and React

## [1.10.0](#13-1-10-0)

-   Released remote-session as beta-feature
-   Added native PHP runtime support as a beta-feature to improve performance
-   Added CLI support for the Blueprints Gallery and improved the Add Site flow
-   Added Linux beta builds, in-app update support, and improved certificate trust handling
-   Preserved custom db.php drop-ins when updating Studio’s SQLite integration
-   Updated multiple dependencies, including WP Playground, PHP-Wasm, WordPress packages, and React

## [1.9.0](#14-1-9-0)

-   Introduced the Blueprints Gallery
-   Shared connected WordPress.com sites between the Studio app and CLI
-   Improved Studio Code remote sessions
-   Added GPT 5.5 support and a scaffold\_theme tool for the CLI agent
-   Improved Studio Code agent reliability
-   Fixed several Studio UI, Blueprint upload, and site creation issues
-   Always ask before stopping running sites when quitting Studio
-   Improved Linux packaging and installer size
-   Updated multiple dependencies, including WordPress packages, WP Playground, and PHP-WASM

## [1.8.1 – CLI only](#15-1-8-1-cli-only)

-   Added Telegram remote-session bridge for studio code (PoC)
-   Added /annotate skill with Studio inspector
-   Added toolbar annotations to the site preview
-   Removed Studio Code turn cap handling
-   Switched Agent SDK to auto permission mode
-   Flag HTML block misuse during validation
-   Fixed AI CLI interrupt handling and immediate turn recovery
-   Linux: support installing the Studio CLI
-   Improved –format=json output when no sites are found
-   Fixed WP-CLI post content parsing before porcelain flags

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.8.1)

## [1.7.11 – CLI only](#16-1-7-11-cli-only)

-   Added PromptFoo evaluation framework for code agent
-   Added log rotation for process manager children logs
-   Renamed process manager home from .studio/pm2 to .studio/daemon
-   Fixed Jetpack backup import using stale .ht.sqlite instead of SQL dumps

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.11)

## [1.7.10 – CLI only](#17-1-7-10-cli-only)

-   Added Opus 4.7 support to code agent
-   Queued follow-up prompts during an active agent turn
-   Prompted user to retry on transient API errors in code agent
-   Scaffolded new Studio Code UI behind ENABLE\_STUDIO\_CODE\_UI feature flag
-   Supported inline wpcom auth via STUDIO\_WPCOM\_TOKEN in code agent
-   Truncated cwd in welcome header on narrow terminals
-   Replaced chalk with util.styleText wrapper
-   Updated default PHP version to 8.4
-   Updated multiple dependencies, including WP Playground and PHP-Wasm

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.10)

## [1.7.9 – CLI only](#18-1-7-9-cli-only)

-   Showed compaction status in code agent UI
-   Added /clear command to code agent
-   Added –json flag for headless NDJSON output
-   Showed real-time progress feedback during push/pull from code agent
-   Added push/pull/import/export MCP tools for AI agents
-   Sorted code agent commands and subcommands alphabetically
-   Added hosting guidance to agent instructions
-   Added update notifier
-   Throttled dependency update checks to once per 24h
-   Stopped runtime update checks for WP-CLI and sqlite-command
-   Showed clear error for non-existent WordPress versions
-   Enforced minimum node version
-   Ensured Studio root exists before starting code agent
-   Fixed ‘Spinner is already running’ error when creating sites via CLI
-   Replaced ora with picospinner
-   Added Blueprint landingPage property support
-   Updated multiple dependencies, including WP Playground and PHP-Wasm

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.9)

## [1.8.0](#19-1-8-0)

-   Added resizable sidebar
-   Added `.deployignore` support for Sync to exclude files from pushes
-   Added zip file support for bundled Blueprints
-   Added `/rank-me-up` on-page SEO audit skill to Studio Code
-   Added auto-install of Playwright Chromium for MCP tools
-   Added `--all` flag to preview list command
-   Misc Studio Code improvements
-   Updated SQLite Database Integration to v3.0.0-rc.1
-   Fixed stale phpMyAdmin assets after Studio updates
-   Fixed stale protocol handler registration on app boot
-   Fixed path traversal vulnerability in .wpress extractor (reported independently by [flouciel](https://hackerone.com/flouciel) and [k4sperski](https://hackerone.com/k4sperski))
-   Fixed excessive word spacing on Linux caused by emoji-font fallback  
    Fixed empty window on first \`npm start\` in a fresh workspace
-   Updated multiple dependencies, including WP Playground and PHP-Wasm

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.8.0)

## [1.7.8](#20-1-7-8)

-   Released `studio` code command
-   Added push/pull and import/export commands to the CLI
-   Added .deployignore support for Preview Sites to exclude files from deploys
-   Redesigned titlebar: window title, button sizing, offline indicator 
-   Improved rendering correct error and buttons when pull failed
-   Fixed SSL certificate trust nudge on non-English Windows
-   Fixed blueprint local resource resolution when creating sites from the app
-   Fixed account settings button opening general tab instead of account
-   Fixed site sort order not preserved across app restarts
-   Miscellaneous minor improvements to CLI
-   Miscellaneous smaller UI improvements
-   Miscellaneous dark mode improvements
-   Updated multiple dependencies, including WP Playground and PHP-Wasm

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.8)

*April 13, 2026*

## [1.7.7](#21-1-7-7)

-   Added dark mode support
-   Added phpMyAdmin support
-   Ship AI instructions with every newly created site
-   Fixed issue where site status wouldn’t show up correctly in app
-   Rename ‘Open site’ to ‘Open local site’ in header
-   Improve Playground CLI child process error handling
-   Move login into Account tab and rename settings tabs
-   Migrated config files, HTTPS certificates, and WordPress dependencies `~/.studio` 
-   Updated multiple dependencies, including WordPress packages, and PHP-WASM

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.7)

*March 27, 2026*

## [1.7.6](#22-1-7-6)

-   Added enableMultisite Blueprint step support
-   Added admin credentials to interactive CLI site creation flow
-   Prefilled admin email and made it mandatory during site creation
-   Improved app quit reliability by always killing PM2 daemon on site stop
-   Improved deeplink connection speed
-   Fixed site processes opening terminals on Windows
-   Fixed removing sites when site folder is already removed
-   Fixed Open file in IDE to respect user’s preferred edito
-   Fixed re-selecting the same file not triggering the import
-   Fixed unsafe type assertions
-   Renamed VS Code labels to Visual Studio Code
-   Replaced pm2 and pm2-axon with homegrown solutions for process management
-   Updated multiple dependencies, including Electron, Sentry, WordPress packages, and PHP-WASM

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.6)

*March 16, 2026*

## [1.7.5](#23-1-7-5)

-   Added Redis and Memcached support
-   Added drag-and-drop site reordering
-   Added WP\_DEBUG\_LOG and WP\_DEBUG\_DISPLAY toggles in site settings
-   Added support for editing admin credentials during site creation and in site settings
-   Added “Open Debug Log” button in Settings and “Open Application Logs” to the Help menu
-   Added a time tooltip to the pull and push completion notification
-   Added Blueprint details step to the blueprint selection flow
-   Made CLI site create command interactive
-   Improved app quit speed by timing out site stop after 6 seconds
-   Disabled Copy and Delete in context menu while a site is being added
-   Fixed import to include hidden files within wp-content
-   Fixed push cancellation error dialog
-   Fixed Preview site and Push size validation to exclude archived-out directories
-   Fixed CLI uninstall on Windows not removing bin directory
-   Fixed CLI locale strings displaying in English
-   Fixed toggle sidebar icon alignment after the Add Site modal
-   Improved accessibility attributes in site settings
-   Improved compatibility of Studio sites with legacy mu-plugin in the filesystem
-   Updated multiple dependencies, including Electron, WordPress Playground, PHP-WASM, Sentry, and WordPress packages

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.5)

*March 6, 2026*

## [1.7.4](#24-1-7-4)

-   Added PHP 8.5 support
-   Added copy site feature to the site context menu
-   Added Hungarian localization
-   Added Blueprint’s defineSiteUrl support
-   Added Blueprint’s blogname support to prefill site name field
-   Enabled Xdebug support for all users
-   Fixed an issue with site start/stop status
-   Added ability to start all stopped sites
-   Fixed printing JSON keys to camelCase in Studio CLI site status output 
-   Included additional bug fixes and maintenance updates.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.4)

*February 17, 2026*

## [1.7.3](#25-1-7-3)

-   Added Zed and Antigravity editor support
-   Fixed incorrect WordPress version warning when applying Blueprints
-   Fixed an issue where deleting multiple sites at once could fail
-   Fixed tab selection after site deletion
-   Fixed sites failing to start when Studio is installed in a path containing spaces
-   Fixed Studio CLI –skip-site-details flag for already-running sites
-   Included additional bug fixes and maintenance updates.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.3)

*February 3, 2026*

## [1.7.2](#26-1-7-2)

-   Added pause and resume functionality during the push process in Studio Sync
-   Improved site creation speed
-   Improved error details when the Studio CLI fails
-   Fixed thumbnail not loading for newly created sites
-   Fixed site export in offline mode
-   Fixed translation of Beta Features menu items

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.2)

*January 28, 2026*

## [1.7.1](#27-1-7-1)

-   Fixed Node.js permissions bug on Intel Macs
-   Fixed excessive WP-CLI command invocations

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.1)

*January 26, 2026*

## [1.7.0](#28-1-7-0)

[![Settings menu in a WordPress application showing options for language, code editor, terminal application, and Studio CLI.](https://developer.wordpress.com/wp-content/uploads/2025/05/studio-enable-cli-1.jpg)](https://developer.wordpress.com/wp-content/uploads/2025/05/studio-enable-cli-1.jpg)

-   Expanded the [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/)
    -   Added site management commands
    -   Added authentication commands
    -   Added WP CLI support
-   Improved Xdebug support (Beta Feature)
-   Added file upload progress and offline status indicator in Sync user interface
-   Increased Sync push size limit to 5GB
-   Added support for Blueprint translations
-   Improved performance on Mac and Windows
-   Improved the speed of creating a WordPress site in online mode
-   Updated SQLite plugin to 2.2.16, improving MySQL compatibility
-   Included additional bug fixes and maintenance updates.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.7.0)

*January 23, 2026*

## [1.6.8](#29-1-6-8)

-   Made Sync uploads resumable, and improved Sync safety and feedback (including preventing site deletion during Sync and providing clearer error states).
-   Added a Telex information banner to the Assistant tab.
-   Improved Studio update dialogs with clearer messaging and Esc-key handling.
-   The “What’s new” modal no longer appears until at least one site has been created.
-   Fixed the Windows auto-updater so ARM64 installations receive the correct installer architecture.
-   Disabled “Import from WordPress.com” when Studio is offline.
-   Included additional bug fixes and maintenance updates.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.8)

*January 6, 2026*

## [1.6.7](#30-1-6-7)

-   Fixed issues with auto-updates.
-   Fixed creation of new sites after pulling an existing site.
-   Fixed plugin and theme installation in the Studio Assistant.
-   Improved pulling existing sites with better loading states and fewer path conflicts.
-   Improved error handling when importing invalid file formats.
-   Refined the “Add Site” experience.
-   Improved feedback when access is denied during authentication.
-   Added app architecture information to the About dialog.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.7)

*December 15, 2025*

## [1.6.6](#31-1-6-6)

[![Screenshot of the 'Add a site' interface in WordPress Studio, displaying options to create a new site, start from a Blueprint, pull an existing site, or import from a backup.](https://developer.wordpress.com/wp-content/uploads/2025/07/studio-changelog-166.jpg)](https://developer.wordpress.com/wp-content/uploads/2025/07/studio-changelog-166.jpg)

-   Added a new “Pull an existing site” flow to create a local site directly from a live WordPress.com site.
-   Added a “Publish site” button to deploy local sites back to WordPress.com.
-   Enabled Blueprint outputs from the built-in Studio Assistant to open directly in Studio.
-   Added a toggle in Settings for installing or uninstalling the Studio CLI.
-   Added a warning when pushing a site that’s running an outdated WordPress version.
-   Add the ability to [launch Studio sites from a Blueprint](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/open-in-wordpress-studio-button/) using deep links.
-   Improved the push dialog to show the size of the selected sync.
-   Improved the onboarding flow for WordPress.com authentication.
-   Ensured the bundled SQLite plugin stays up to date when launching sites via the CLI.
-   Fixed an issue that prevented the “Add blank site” modal from closing.
-   General UI polish and performance improvements.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.6)

*December 9, 2025*

## [1.6.5](#32-1-6-5)

-   Fixed the broken WP-CLI support introduced in 1.6.4.
-   Resolved update failures on Windows.
-   Added beta support for multi-worker launch in the Playground CLI.
-   Introduced translated progress messages for the Playground CLI.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.5)

*November 25, 2025*

## [1.6.4](#33-1-6-4)

-   Added a beta flow for creating a new site from a remote site.
-   Introduced new CLI commands for logging in and out of WordPress.com.
-   Added support for base64-encoded Blueprints in deeplinks.
-   Updated deeplink URL scheme from `wpcom-local-dev` to `wp-studio`.
-   Excluded database files from push operations for better stability.
-   Improved push success emails with detailed sync information.
-   Fixed issues with connected sites after login and sync option handling.
-   Upgraded Playground, PHP-WASM, and SQLite dependencies.
-   Miscellaneous UI and performance improvements.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.4)

*November 24, 2025*

## [1.6.3](#34-1-6-3)

-   Improved selective push and export to include all folders within `wp-content`.
-   Separated staging and production sites in the Sync modal.
-   Added a new developer survey in the *What’s New* modal.
-   Improved terminal app detection and selection.
-   Fixed RTL styling and other minor UI issues.
-   Updated Electron, Playground packages, and other dependencies.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.3?utm_source=chatgpt.com)

*November 7, 2025*

## [1.6.2](#35-1-6-2)

-   You can now cancel push and pull operations, giving you more control when syncing sites.
-   Added a new Beta Features menu to test experimental functionality before full release.
-   Windows ARM64 builds are now supported.
-   Improved the Add Site flow so you can easily revisit completed setup steps.
-   Updated the sync modal design for a cleaner, more intuitive experience.
-   Fixed several bugs affecting plugin downloads, preview cleanup, and window sizing.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.2)

*October 27, 2025*

## [1.6.1](#36-1-6-1)

[![The context menu in Studio 1.6.1.](https://developer.wordpress.com/wp-content/uploads/2025/07/studio-context-menu.jpg)](https://developer.wordpress.com/wp-content/uploads/2025/07/studio-context-menu.jpg)

-   Added a new site context menu for quicker access to common actions in the site sidebar, as shown in the image above.
-   Improved progress reporting during site imports for better clarity.
-   Upgraded the bundled SQLite plugin for improved stability and compatibility.
-   Fixed focus issues when switching between tabs in the app.
-   Resolved broken “Customize” links in classic themes.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.1)

*October 14, 2025*

## [1.6.0](#37-1-6-0)

![](https://developer.wordpress.com/wp-content/uploads/2025/10/studio-add-site-blueprints-16-1.jpg)

-   Added support for [Blueprints](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/), allowing you to define plugins, themes, and settings for new sites to create consistent environments faster. This work introduces a new “**Add site**” flow featuring a dedicated screen where you can choose between adding an empty site, selecting a Blueprint, or importing a backup.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/10/08/introducing-blueprints-in-wordpress-studio-1-6-0/)
    -   [Learn how to create Blueprints](https://developer.wordpress.com/docs/guides/how-to-create-custom-blueprints/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/)
-   Introduced Selective Syncing in the pull dialog, giving you more control over what content and code changes to sync.
-   Migrated from wp-now to the [Playground CLI](https://wordpress.github.io/wordpress-playground/developers/local-development/wp-playground-cli/) for improved performance, reliability, and better parity with WordPress Playground.
-   Added support for Sublime Text as an external code editor.
-   Improved reliability when pushing large sites and refined export behavior to preserve information about completed exports.
-   Migrated the internal bundler from Webpack to Vite, resulting in faster builds and a smoother developer experience.
-   Fixed missing fonts on macOS Tahoe.
-   Hid the What’s New modal for first-time users to streamline onboarding.
-   Updated core dependencies, including Electron, Forge, Playground, and the SQLite plugin, to the latest versions for enhanced speed and stability.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.6.0)

*October 7, 2025*

## [1.5.6](#38-1-5-6)

-   We upgraded Studio’s SQLite plugin and enabled a new AST driver under the hood, helping power faster, more stable local environments.
-   Studio now opens the Overview tab by default after creating or deleting a site, streamlining your workflow and reducing friction.
-   We’ve improved offline functionality, so you can now delete sites and log out even without an internet connection.
-   A better crash screen now appears if something goes wrong, and we fixed a startup bug that occurred when launching Studio from a read-only directory.
-   Other improvements include support for sites with custom environment types, suppressed punycode warnings in both the app and CLI, and minor UI tweaks to make selective sync safer by default.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.6)

*August 7, 2025*

## [1.5.5](#39-1-5-5)

![a screenshot of the Pull from Production modal window in WordPress Studio with Files and folders checked](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-selective-sync.jpg)

-   Introducing Selective Sync. No more all-or-nothing deployments. Push or pull only what you need. Ideal for shipping themes or plugins safely.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/07/14/selective-push-pull-wordpress-studio/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/sync/)
-   Studio by WordPress.com is now WordPress Studio, signaling a broader mission and cross-host compatibility.
-   Studio now fully revokes your token on logout, helping protect your account across shared or multiple devices.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.5)

*July 14, 2025*

## [1.5.4](#40-1-5-4)

![An orange arrow pointing to the preferences wheel in WordPress Studio](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-open-preferences.jpg)

-   There’s a new Settings button that makes it easier to jump straight into your Studio preferences, where you can specify your app language and default code editor and terminal application. 

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.4)

*June 23, 2025*

## [1.5.3](#41-1-5-3)

-   Studio now supports symlinks in Previews and Sync, making it easier to work with complex or modular project structures.
-   We’ve improved site export performance, network reliability, and Windows editor detection, making Studio faster, more stable, and more intuitive across the board.
-   We upgraded the Electron Forge and WordPress Playground packages.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.3)

*June 9, 2025*

## [1.5.2](#42-1-5-2)

![The connect modal window in WordPress Studio showing WordPress.com and Pressable sites](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-sync-connect.jpg)

-   You can now sync Studio sites directly with Pressable staging and production sites.
    -   [Learn more in Pressable’s blog post](https://pressable.com/blog/build-locally-sync-seamlessly-studio-now-works-with-pressable/)
    -   [Explore the Pressable docs](https://pressable.com/knowledgebase/studio-for-pressable/)
-   Push progress is now clearer, and an email notification will confirm when a push is successful.
-   We’ve made behind-the-scenes improvements to syncing, preview limits, and plugin updates for better reliability across the board.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.2)

*May 26, 2025*

## [1.5.1](#43-1-5-1)

![The preferences window in WordPress Studio showing drop-down menus for language, code editor, and terminal](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-editor-preferences-1.jpg)

-   Choose your preferred code editor (Visual Studio Code, Cursor, Windsurf, PhpStorm, or WebStorm) and terminal app (Terminal, Command Prompt, Warp, Ghostty, or iTerm2) for easy access to your Studio files.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/05/12/preferences-studio/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/sites/#6--open-in-section)
-   We’ve updated the default PHP version to 8.3 and made multiple Windows-specific improvements to HTTPS and certificate handling.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.1)

*May 12, 2025*

## [1.5.0](#44-1-5-0)

![An orange arrow pointing to the Install CLI menu item in WordPress Studio](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-install-cli.jpg)

-   Studio now includes a CLI for managing Preview Sites so you can create, list, and delete Preview Sites right from your terminal. Perfect for developers who want to script common tasks or streamline their local workflow.
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/cli/)

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.5.0)

*May 5, 2025*

## [1.4.0](#45-1-4-0)

-   A new in-app “What’s New” popup gives you a quick look at the latest features and changes.
-   The Studio sites you were working on now auto-start when you relaunch Studio, helping you pick up right where you left off.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.4.0)

*April 14, 2025*

## [1.3.9](#46-1-3-9)

![the use custom domain modal window in WordPress Studio](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-use-custom-domain.jpg)

-   Studio now supports SSL for custom domains, allowing you to develop with SSL/HTTPS enabled and to create a more production-like environment locally.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/#2-enabling-https-for-a-site)
-   Support was added for nightly WordPress versions.
-   You can now import/export a site while another local site is syncing.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.9)

*March 31, 2025*

## [1.3.8](#47-1-3-8)

![The add site window in WordPress Studio showing drop-down menus for PHP and WordPress versions](https://developer.wordpress.com/wp-content/uploads/2025/07/studio-add-site-php-wordpress-version.jpg)

-   Choose the PHP and WordPress version you need when creating a site to test compatibility, reproduce bugs locally, or build for specific client requirements.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/sites/#Using-a-custom-domain-and-SSL)
-   Added support for custom domains to test features that require proper domain names.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/sites/#Using-a-custom-domain-and-SSL)

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.8)

*March 17, 2025*

## [1.3.7](#48-1-3-7)

-   We fixed a bug related to the rotatePHPRuntime setting that could cause sites to crash unexpectedly.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.7)

*March 6, 2025*

## [1.3.6](#49-1-3-6)

-   Studio now handles symlinks and custom site paths more reliably on Windows, improving compatibility with a wider range of local setups.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.6)

*March 6, 2025*

## [1.3.5](#50-1-3-5)

-   When creating a new site, Studio now suggests unique paths and names automatically, reducing confusion and preventing accidental overwrites.
-   We also fixed compatibility issues with older versions of SQLite to ensure more consistent performance across different environments.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.5)

*March 4, 2025*

## [1.3.4](#51-1-3-4)

![The Preview Sites area on WordPress Studio](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-preview-sites.jpg)

-   Demo Sites are now called Preview Sites. With 2 GB of space each, you can work with larger themes, more media assets, and richer content during your development process.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/02/24/studio-preview-sites/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/)
-   Tunneling is now supported, allowing you to define `WP_SITEURL` and `WP_HOME` in `wp-config.php` for external access via tools like ngrok. That means you can test Studio sites on real devices or share them temporarily for client previews and responsive testing.
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studiofrequently-asked-questions/#11-how-can-i-use-a-tunneling-tool-ngrok-with-studio-)
-   Studio docs are now [localized in Spanish](https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/).

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.4)

*February 24, 2025*

## [1.3.3](#52-1-3-3)

-   We added support for mu-plugins in site import, plus improvements to ZIP import, fullscreen behavior on macOS, and terminal UX on Windows.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.3)

*February 5, 2025*

## [1.3.2](#53-1-3-2)

-   Studio’s Demo Site limit is now 2 GB (up from 250 MB), giving you more space to test, gather feedback, and iterate on your local sites.
-   We upgraded the Electron version powering Studio to 33.3.1.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.2)

*January 21, 2025*

## [1.3.1](#54-1-3-1)

-   Studio now supports importing a site when another one is already in progress. 
-   You can now select a custom domain when setting up a new WordPress.com site from the Studio UI.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.1)

*January 13, 2025*

## [1.3.0](#55-1-3-0)

-   Introducing Studio Sync, making it easy to push and pull changes between your local Studio environment and live or staging sites on WordPress.com (Business or Commerce plans). You can push local changes to production, pull down the latest version to work locally, or collaborate across teams by linking multiple Studio installs to the same hosted site.
    -   [Learn more in our blog post](https://wordpress.com/blog/2025/01/06/studio-sync/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/sync/)
-   We bumped the default PHP version to 8.2 and improved RTL layout handling.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.3.0)

*January 3, 2025*

## [1.2.2](#56-1-2-2)

![The WordPress Studio listing in the Microsoft Store](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-microsoft-store.jpg)

-   Studio is now available as an AppX installer, making it easier than ever to install directly [from the Microsoft Store](https://apps.microsoft.com/detail/9pntbl35pzvs?hl=en-US&gl=US) on Windows devices.
-   We’ve improved the accuracy of theme and plugin exports, so your backups are cleaner and more portable across environments.
-   Sites now start automatically after import, helping you get back to development faster with fewer clicks.
-   We also resolved login issues with Jetpack-enabled sites by disabling Jetpack Protect in local environments, making autologin more reliable during development.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.2.2)

*November 25, 2024*

## [1.2.1](#57-1-2-1)

-   We streamlined the site import process by removing unnecessary steps related to media regeneration. That means faster imports and less waiting around when setting up a site.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.2.1)

*November 11, 2024*

## [1.2.0](#58-1-2-0)

![The Studio Assistant RUN button in WordPress Studio](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-assistant-run.jpg)

-   Meet Studio Assistant, your new built-in AI for getting the most out of Studio. With the Studio Assistant, you can quickly configure new sites, manage existing sites, and run complex WP-CLI commands, all through a simple and intuitive chat interface.
    -   [Learn more in our blog post](https://wordpress.com/blog/2024/10/29/studio-assistant/)
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/sync/)
-   We also refreshed the interface with cleaner styling and improved window handling on macOS, making Studio feel more native, modern, and responsive.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.2.0)

*October 29, 2024*

## [1.1.4](#59-1-1-4)

-   Studio now supports importing .wpress backup files, making it easier to bring in full site backups created with common WordPress tools.
-   We’ve also improved error messages during the import process, helping you troubleshoot faster.
-   You can now open the Settings menu even when you’re offline, great for tweaking preferences without needing a live connection.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.1.4)

*October 14, 2024*

## [1.1.3](#60-1-1-3)

-   Studio now fully supports symlinks, unlocking smoother workflows for advanced development.
-   We also use the default PHP version when running the WP-CLI sqlite import command.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.1.3)

*September 30, 2024*

## [1.1.2](#61-1-1-2)

-   Studio is now fully responsive, making it easier to use on smaller screens or in split-view setups.
-   We added a sidebar toggle to help you focus in-app, along with several quality-of-life improvements to local path handling.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.1.2)

*September 16, 2024*

## [1.1.1](#62-1-1-1)

-   You can now switch Studio’s language from the Settings menu, unlocking Studio usage for users around the world.
-   We improved compatibility with WooCommerce and polished terminal behavior, WordPress Playground interactions, and UI details throughout the app.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.1.1)

*September 10, 2024*

## [1.1.0](#63-1-1-0)

![An orange arrow pointing out the import/export section in WordPress Studio](https://developer.wordpress.com/wp-content/uploads/2025/07/wordpress-studio-import-export.jpg)

-   You can now export and import full WordPress sites with a single click, making it easier to move projects between machines, collaborate with teammates, or work on a production or staging site on any WordPress host.
    -   [Explore the docs](https://developer.wordpress.com/docs/developer-tools/studio/import-export/)
-   We also added support for Ukrainian and rolled out general UI improvements.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.1.0)

*August 20, 2024*

## [1.0.7](#64-1-0-7)

-   We improved how Studio handles testing timers and reduced the risk of data corruption during simultaneous operations.
-   A new message alerts users if their account doesn’t support Demo Sites, saving confusion during setup.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.7)

*August 5, 2024*

## [1.0.6](#65-1-0-6)

-   Studio now supports Vietnamese, expanding accessibility for more developers.
-   We improved the onboarding experience by fixing issues with the Settings menu and adding subtle UI polish like hover states and loading indicators.
-   Users now receive a helpful reminder to restart after checking for updates.
-   The “Delete site files” checkbox is now checked by default, preventing forgotten leftovers on disk.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.6)

*July 22, 2024*

## [1.0.5](#66-1-0-5)

-   We fixed a crash that occurred when deleting sites and improved the clarity of confirmation dialogs throughout the app.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.5)

*July 8, 2024*

## [1.0.4](#67-1-0-4)

-   Windows users can now speed up sites using a new performance modal.
-   We also added the ability to change the PHP version per site, great for testing across versions, and bumped the default to PHP 8.1.
-   New menu links make it easier to submit feedback, and we improved translation support and fixed race conditions during site creation.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.4)

*June 17, 2024*

## [1.0.3](#68-1-0-3)

-   Studio is now available for Windows users.
    -   [Learn more in our blog post →](https://wordpress.com/blog/2024/05/29/studio-windows/)
-   Plugin, theme, and core updates are now fully functional again, and we fixed update flows on Windows.
-   We also introduced an application menu for Windows, improved Sentry logging, and squashed several platform-specific bugs.
-   You can now delete all Demo Sites at once, and Studio will handle permalink structures without needing index.php.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.3)

*May 29, 2024*

## [1.0.2](#69-1-0-2)

-   We made Studio feel snappier by moving key processes to separate threads and reducing layout issues on Windows and RTL languages.
-   WooCommerce and font uploads work more reliably, and external resources like YouTube now resolve correctly.
-   Design tweaks across onboarding, layout, and headers polished the experience across platforms.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.2)

*May 16, 2024*

## [1.0.1](#70-1-0-1)

-   Your WordPress.com profile photo now links to your account, and Studio helps users download the right version of the app for their machine.
-   We improved support for RTL languages and long translations, confirmed deletions using native OS dialogs, and resolved crashes caused by demo site status issues.
-   Other improvements include a copy button for demo URLs, better keyboard navigation, smarter error handling, and more consistent drag behavior.

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.1)

*May 13, 2024*

## [1.0.0](#71-1-0-0)

-   Hello, world. Welcome to Studio, local WordPress development made simpler, faster, and more accessible for everyone.
    -   [Learn more in our blog post](https://wordpress.com/blog/2024/04/24/studio/)

[View release notes](https://github.com/Automattic/studio/releases/tag/v1.0.0)

*April 29, 2024*