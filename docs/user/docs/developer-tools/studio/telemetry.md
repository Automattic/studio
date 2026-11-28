# Telemetry in WordPress Studio

WordPress Studio sends usage events to Automattic, the company behind WordPress Studio and WordPress.com, to learn which features people use and where they get stuck. This page explains what those events contain, what they never contain, and how to turn them off.

**Applies to:** the WordPress Studio app, WordPress Studio UI (`studio ui`), and the WordPress Studio CLI.

## Why WordPress Studio collects usage data

Usage events help the WordPress Studio team:

- **Improve the product.** For example: which features people use, where sites fail to start, which steps of publishing break, and whether people who use WordPress Studio go on to buy hosting.
- **Support and debug.** When you contact support, the team can see which steps failed and on which version, without asking you to reproduce the problem.
- **Send relevant emails.** When you’re logged in to WordPress.com, your usage can shape emails about WordPress Studio, such as tips for a feature you haven’t tried yet. You control these emails separately. See [Emails from WordPress Studio](#emails-from-wordpress-studio).

## Logged out and logged in

**Logged out:** events are anonymous. Each one carries a random ID that WordPress Studio creates the first time it sends an event. The ID identifies the install on your computer, not you, and the app and the CLI share it.

**Logged in to WordPress.com:** events carry your WordPress.com user ID instead of the random ID, so usage can be tied to your account. They don’t carry your email, your display name, or any of the things listed in [What’s never collected](#whats-never-collected).

Linking only applies going forward:

- Events sent while you’re logged in don’t carry the random install ID, so your earlier anonymous usage is never joined to your account.
- Nothing is linked until you’ve seen this explained. On a new install, that’s during onboarding. If you already use WordPress Studio, it’s once you dismiss a one-time notice in the app.

**CLI only:** if you use the WordPress Studio CLI without the app, events stay anonymous for now, even when you’re logged in with `studio auth login`.

## What’s collected

Every event records:

- The event name and the time it happened
- Your operating system and CPU architecture (for example `darwin` and `arm64`)
- The WordPress Studio version
- Where it came from: the app, WordPress Studio UI in a browser, the CLI, or an agent app through the [MCP server](https://wordpress.studio/docs/mcp-on-studio/)
- Whether you’re logged in with an Automattic employee account (yes or no, worked out from the email domain on this computer; the email itself isn’t sent)
- The random install ID or, when you’re logged in, your WordPress.com user ID

Most events add a few details of their own, such as whether an action succeeded, how long it took, or which option you chose. Failures are reported as a short category, such as `timeout` or `disk_full`, never as the error message. Some events include a random ID that WordPress Studio creates for a site, preview, or chat, so events about the same one can be counted together. These IDs aren’t made from the site’s name or address.

| Area | Events | What they record, besides the above |
| --- | --- | --- |
| App and onboarding | `studio_app_launch`, `studio_onboarding_viewed`, `studio_onboarding_complete`, `studio_panel_opened`, `studio_workspace_layout_changed` | Whether it’s the first launch, which onboarding step you saw and how you finished it, which panel or layout you chose |
| WordPress.com account | `studio_account_prompt_viewed`, `studio_wpcom_auth_started`, `studio_wpcom_auth`, `studio_wpcom_auth_cancelled`, `studio_wpcom_auth_launch_failed`, `studio_account_journey_completed` | Where you started logging in, whether you chose to sign up or log in, whether it worked, and which task you went on to complete (such as creating a preview) |
| Sites | `studio_site_created`, `studio_site_create_failed`, `studio_site_start`, `studio_site_stop`, `studio_site_delete`, `studio_site_imported`, `studio_site_exported` | PHP and WordPress versions, how the site was made (new, Blueprint, import, duplicate…), whether it uses a custom domain or SSL (yes or no), how long it took to create or start, how many sites are running |
| Blueprints in Add site | `studio_blueprint_viewed`, `studio_blueprint_use_case_filter_changed`, `studio_blueprint_preview_in_browser`, `studio_blueprint_create_site_intent`, `studio_blank_site_selected` | The Blueprint’s public gallery name and the category filter |
| Working on a site | `studio_site_open_in_browser`, `studio_site_open_wp_admin`, `studio_site_open_customize`, `studio_site_open_phpmyadmin`, `studio_site_open_design_system`, `studio_site_open_email`, `studio_site_open_folder`, `studio_site_open_in_editor`, `studio_site_open_in_terminal`, `studio_responsive_preview_changed` | Whether it opened in the app or your browser, which editor or terminal app, which device preset and a size range for responsive preview |
| Preview sites | `studio_preview_site_create`, `studio_preview_site_update`, `studio_preview_site_delete`, `studio_preview_site_delete_all` | Success, how long it took, how many previews the site has |
| Publish and pull | `studio_sync_push`, `studio_sync_pull`, `studio_sync_connect`, `studio_sync_disconnect`, `studio_sync_create_site`, `studio_sync_publish_site` | Success, how long it took, the hosting provider (WordPress.com, Pressable…), how many live sites a local site is connected to |
| WordPress Studio Code | `studio_code_session_created`, `studio_code_message_sent`, `studio_code_turn_completed`, `studio_annotation_submitted`, `studio_code_design_option_proposed`, `studio_code_design_option_picked` | The AI provider, model and thinking level, which built-in skill ran, whether you attached images or files, how the reply ended, how long it took, token counts, how many tool calls and edits it made, which design options were offered and which you picked |
| MCP server | `studio_mcp_session_start` | The agent app’s name (for example `claude-code`) and the Studio plugin version, when the plugin started the server |
| Settings | `studio_setting_telemetry_change`, `studio_setting_appearance_change`, `studio_setting_language_change`, `studio_setting_code_editor_change`, `studio_setting_terminal_change`, `studio_setting_default_directory_change`, `studio_setting_quit_action_change`, `studio_setting_cli_change`, `studio_setting_instructions_change`, `studio_setting_ai_provider_change` | The new value for settings with a fixed list of choices (such as light or dark, a language, an editor), whether the sites folder is the default one, a rough length for your instructions, which AI provider you connected and how (plan or API key) |

## What’s never collected

Usage events never include:

- Your email address, display name, or WordPress.com username
- Site names, URLs, domain names, or site content
- File names or file and folder paths
- Your prompts, WordPress Studio Code’s replies, the text of your instructions, or what you type into a design question
- Passwords, API keys, or tokens
- The text of error messages
- The name of a model you run yourself, or its server’s address (it’s sent as `local-model`)
- Blueprints you upload, or preview and screenshot URLs

## Where the data goes

Usage events go to Tracks, Automattic’s own analytics service. They aren’t sold or shared with third parties. They’re kept as long as other WordPress.com usage data. For details, see the [Automattic Privacy Policy](https://automattic.com/privacy/).

## Emails from WordPress Studio

Emails about WordPress Studio have their own setting, separate from usage statistics. It’s the **WordPress Studio** option in your [WordPress.com notification settings](https://wordpress.com/me/notifications/extras). It’s on by default, and you can turn it off there or unsubscribe at any time.

## Turn off usage statistics

The usage statistics setting turns off every usage event, logged in or not. You can change it at any time:

- **During onboarding:** clear the usage statistics checkbox in the **Welcome to WordPress Studio** dialog.
- **In Settings:** open **Settings** from the account menu at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux). On the **General** page, turn off the usage statistics option. WordPress Studio UI (`studio ui`) has the same setting.
- **To turn it back on:** use the same option, or the command for it in the command palette (⌘K, or Ctrl+K on Windows and Linux).

The app and the CLI read the same setting from `~/.studio/config.json`, so turning it off in one turns it off in the other. The CLI has no command or flag of its own for it. If you only use the CLI, run `studio ui` and change it in **Settings**.

### What the setting doesn’t cover

Turning off usage statistics stops the events on this page. WordPress Studio still sends:

- Anonymous launch and site counters: a count with no ID attached, used to know roughly how many people use WordPress Studio.
- Crash and error reports, used to find and fix bugs.
