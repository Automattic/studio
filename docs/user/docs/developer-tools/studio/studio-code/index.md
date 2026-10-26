# Studio Code

Studio Code is an agentic coding tool built into the Studio desktop app and [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/).

It gives you an interactive chat where you can build, customize, and manage WordPress sites conversationally, creating themes and plugins, editing files, running WP-CLI commands, deploying previews and publishing your site.

Using it requires you to be logged into your WordPress.com account and [having a payment method on WordPress.com is required](http://wordpress.com/me/purchases/add-payment-method) to prevent abuse. 

## [Getting started](#0-getting-started)

Studio Code is available in the Studio desktop app and as part of the standalone Studio CLI npm package.

### [Studio Code in Studio Desktop](#1-studio-code-in-studio-desktop)

Studio Code in the Studio desktop app is built into a friendly, familiar interface and doesn’t require npm dependencies.

Open your WordPress Studio desktop app and select a site in the sidebar (or add a new site). Studio Code is the chat pane next to the site preview: type your request in the chat box at the bottom. If you aren’t logged in, the pane shows a **Log in with WordPress.com** button instead.

[![Studio Code chat pane for a selected site](https://developer.wordpress.com/wp-content/uploads/2026/04/studio-code.png)](https://developer.wordpress.com/wp-content/uploads/2026/04/studio-code.png)

### [Studio Code in Studio CLI](#2-studio-code-in-studio-cli)

If you have the Studio desktop app installed with the [CLI enabled](https://developer.wordpress.com/docs/developer-tools/studio/cli/#0-installation), you can directly use `studio code` from the terminal.

Otherwise, you can run it directly with `npx`:

npx wp-studio@latest code

And can install it globally to use `studio code` directly:

npm i -g wp-studio@latest
studio code

![Studio Code running in a terminal window](https://developer.wordpress.com/wp-content/uploads/2026/04/studio-code-terminal-wordpress-studio.png)

Press the ↓ arrow to work in your local Studio sites, or ↓ and → to work in your WordPress.com- or Jetpack-connected sites.

## [Connect to WordPress.com](#3-connect-to-wordpress-com)

By default, Studio Code uses WordPress.com infrastructure to generate AI responses. Log in to WordPress.com to get started — [in the desktop app](https://developer.wordpress.com/docs/developer-tools/studio/#connect-wordpress-com) or in your terminal by following the instructions below:

1.  Run `studio code` in your terminal.
2.  Type /login in the chat.
3.  A browser window will open. Log into your WordPress.com account and approve the connection.
4.  Paste the authorization token back into the terminal to complete the login.

Alternatively, you can [use your own Anthropic API key](#17-use-your-own-anthropic-api-key): type /api-key in the chat in the terminal, or add it in **App settings → AI** in the desktop app.

## [Using Studio Code](#4-using-studio-code)

Type your request in natural language and the AI agent will execute for you, creating files, running commands, and making changes to your site.

### [Example workflows](#5-example-workflows)

**Create a new site and customize it:**

-   Create a new WordPress site called “My Portfolio” with PHP 8.2
-   Build a minimal portfolio theme with a dark color scheme
-   Add a homepage with a hero section and project grid

**Share your work:**

-   Create a preview site so I can share this with my client
-   Update the preview site with my latest changes

**Publish your work:**

-   Publish “My Portfolio” site to examplesite.com

The agent can read and write files in your site directory, run WP-CLI commands, take screenshots of your site, and push changes to WordPress.com, all based on your instructions.

### [Designing a site](#designing-a-site)

When you ask Studio Code to build a site, it first offers you four looks, and then four layouts previewed in the look you picked. It skips these questions when your request already describes a design. Your choice is saved as `DESIGN.md` in the site’s root folder, and later chats, as well as other coding agents, follow it. Fonts chosen in `DESIGN.md` are self-hosted on the site.

To review the design system, open the site preview’s address menu and choose **Design system**. It shows the colors, type scale, spacing and corners, components, and guidelines from `DESIGN.md`. If the theme’s `theme.json` no longer matches `DESIGN.md`, Studio lists each difference: choose **Use DESIGN.md** or **Keep theme.json** for each one, or **Apply all from DESIGN.md**.

Studio Code can also generate images for your site. See [Image generation in Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/image-generation/).

To give Studio Code instructions that apply to every new chat, across all your sites, add them in **App settings → AI → Instructions** in the desktop app. For example: “Always answer in French. My sites are for restaurants.”

### [Working with WordPress.com sites](#working-with-wordpress-com-sites)

One Studio Code agent handles both your local sites and your WordPress.com sites, so a single chat can, for example, copy a live post into a local site. When the active site is a WordPress.com site, the agent works on the live site and only makes a local copy if you ask. It never pulls a live site over a local one without your confirmation. See [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/) for how pulling and pushing work.

When the agent edits a block theme’s templates, those edits now also apply to customizations made in the Site Editor, instead of being silently skipped.

### [Slash commands](#6-slash-commands)

While chatting, you can use slash commands for quick actions:

| Command | Description | Available in… |
| --- | --- | --- |
| /annotate | Open a visual inspector to annotate page elements and give the AI agent instructions | Terminal and desktop |
| /api-key | Set or update your Anthropic API key | Terminal |
| /browser | Open the active site in your browser | Terminal |
| /clear | Clear the conversation and start a fresh session | Terminal |
| /credits | Show your AI credit balance and buy more AI credits | Terminal |
| /exit | Exit the chat | Terminal |
| /liberate | Migrate and rebuild a site from a closed platform to WordPress | Terminal and desktop |
| /login | Log in to WordPress.com | Terminal |
| /logout | Log out of WordPress.com | Terminal |
| /model | Switch the AI model tier. | Terminal |
| /need-for-speed | Run a performance audit on your site | Terminal and desktop |
| /preview | Push the active site to WordPress.com as a preview | Terminal |
| /provider | Switch between WordPress.com and Anthropic API | Terminal |
| /publish | Publish the active site to WordPress.com | Terminal |
| /rank-me-up | Run an on-page SEO audit on your site | Terminal and desktop |
| /swag | Treat yourself to some WordPress swag | Terminal |
| /taxonomist | Optimize your category taxonomy | Terminal and desktop |

### [AI model tiers](#7-ai-model-tiers)

Studio Code doesn’t ask you to pick a model by name. Instead, you choose a tier based on how much depth the task needs:

-   **Fast**: everyday changes, small edits, and quick fixes
-   **Balanced**: work that benefits from more careful reasoning
-   **Strong**: complex, multi-step, or architecture-level work

New chats start on Fast. Once your account has purchased AI Credits, new chats start on Balanced instead.

Balanced and Strong require purchased AI Credits. For how tiers differ and how they use credits, see [Choosing an AI model tier in Studio Code.](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/choosing-an-ai-model-tier-in-studio-code/)

Switch tiers at any time, including mid-conversation:

-   **Desktop**: select it from the model menu in the chat box
-   **Terminal**: run the `/model` command

If you use your own Anthropic API key, the model menu lists **Sonnet 5** and **Opus 5** instead of tiers. See [AI providers](#11-ai-providers).

### [Uploads](#8-uploads)

Upload images and files into Studio Code to use across your project:

-   **Desktop**: drag files into the chat, paste them, or click the **+** (**Add skill or attachment**) button in the chat box and choose **Upload attachment**
-   **Terminal**: drag into the chat or point to a specific local file or folder

### [New conversations](#9-new-conversations)

Clear your conversation and start a new one:

-   **Desktop**: click **New chat**, or press ⌘N (Ctrl+N on Windows and Linux)
-   **Terminal**: run the `/clear` command

In the desktop app, your earlier chats are listed under **Chat history**, below the chat box. Use **Archive chat** to move a chat you no longer need to **Archived chats**.

### [AI providers](#11-ai-providers)

You can choose how AI responses are generated, in both the desktop app and the terminal:

-   **WordPress.com** (default): uses your WordPress.com account and AI Credits. No additional setup is required beyond logging in.
-   **Anthropic API key**: uses your own API key for direct access to Claude. In the desktop app, add it in **App settings → AI → Use your Anthropic API key**. In the terminal, set it with the `/api-key` command.

With your own key, the model menu offers **Sonnet 5** and **Opus 5** instead of Fast, Balanced, and Strong. In the desktop app, choose the provider for each chat from the model menu. In the terminal, switch providers with the `/provider` command.

Switching a chat between WordPress.com and Anthropic models starts a new chat, because the models don’t share memory. In the desktop app, Studio asks you to confirm first, and your previous chat stays in **Chat history**.

## [Terminal-specific guidance](#10-terminal-specific-guidance)

The terminal version of Studio Code has a few additional capabilities:

### [Sessions](#12-sessions)

Studio Code automatically saves your conversation history so you can pick up where you left off.

**Resume a session**

```plain
studio code sessions list                  # View all saved sessions

studio code sessions resume                # Interactive picker

studio code sessions resume latest         # Resume the most recent session

studio code sessions resume <id>           # Resume a specific session by ID
```

**Delete a session**

```plain
studio code sessions delete                # Interactive picker

studio code sessions delete <id>           # Delete a specific session
```

**Disable session recording**

If you prefer not to save conversations, use the –no-session-persistence flag:

```plain
studio code --no-session-persistence
```

**Command references**

```plain
studio code                                # Start a new chat session

studio code --path /path/to/site           # Start with a specific site directory

studio code --no-session-persistence       # Start without saving the session

studio code sessions list                  # List saved sessions

studio code sessions resume [id]           # Resume a session

studio code sessions delete [id]           # Delete a session
```

For the full set of options:

```plain
studio code --help
```

## [Usage limits](#13-usage-limits)

### [AI Credits](#14-ai-credits)

When you use the default WordPress.com provider, Studio Code’s AI usage is paid for with AI Credits. Every account starts with a one-time free allowance, which can be used with the Fast tier. To keep going once it runs out, or to use Balanced and Strong, buy AI Credits from inside Studio Code. See [How AI Credits Work](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/) for details on purchases and account rules.

### [Check your usage](#15-check-your-usage)

Studio Code shows your remaining AI Credits as you work:

-   **Desktop**: the **AI credits** meter in the chat box, and **App settings → Usage**
-   **Terminal**: the stats line at the end of each turn, and the `/credits` command

Studio Code warns you when you have used 80% and 90% of your AI Credits.

### [What happens when you reach the limit](#16-what-happens-when-you-reach-the-limit)

AI responses pause until you add more AI Credits. Your local sites keep running normally; only the AI agent is unavailable.

When that happens, you have two options:

1.  **Buy more AI Credits** from inside Studio Code.
2.  **Use your own Anthropic API key** — Usage through your own key is billed by Anthropic and doesn’t use AI Credits.

### [Use your own Anthropic API key](#17-use-your-own-anthropic-api-key)

You can connect Studio Code directly to Anthropic at any time using your own API key. This option is available in the CLI version of Studio Code and in the desktop app.

To use your own key in the desktop app:

1.  Create an API key at [console.anthropic.com](https://console.anthropic.com/) (requires an Anthropic account with billing set up).
2.  Open **App settings** from the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux), and select the **AI** tab.
3.  Paste your key in the **Anthropic API key** field.
4.  In the chat box, choose **Sonnet 5** or **Opus 5** from the model menu.

[![The AI tab in Studio's App settings, with the Studio Code toggle, the Anthropic API key field, and global Instructions](https://developer.wordpress.com/wp-content/uploads/2026/04/app-settings-ai.png)](https://developer.wordpress.com/wp-content/uploads/2026/04/app-settings-ai.png)

To switch it using CLI:

1.  Create an API key at [console.anthropic.com](https://console.anthropic.com/) (requires an Anthropic account with billing set up).
2.  Start Studio Code in your terminal:

```plain
studio code
```

3.  Type `/provider`, and select “Anthropic · API key” in the chat and paste your key when prompted. The key is saved locally for future sessions.

5.  To switch back and forth between providers at any time, use the `/provider` command and choose **WordPress.com** or **Anthropic · API key**.
6.  To change your API key, use the `/api-key` command, which will prompt you to enter a new key.