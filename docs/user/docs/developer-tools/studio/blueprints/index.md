# Blueprints in WordPress Studio

A Blueprint is a JSON file that describes how to build a site in WordPress Studio. This “recipe” tells Studio which WordPress and PHP versions to use, which plugins and themes to install, what content or settings to apply, and more.

Unlike full-site Blueprints in other local development environments, Studio Blueprints are lightweight, declarative, and easy to share. Choose from one of our free starter Blueprints or upload a [Blueprint of your own](https://developer.wordpress.com/docs/guides/how-to-create-custom-blueprints/).

## [How Blueprints work in Studio](#0-how-blueprints-work-in-studio)

When you launch a site with a Blueprint, Studio reads the JSON file and builds the site according to the instructions inside. Instead of copying a pre-existing site, Studio installs and configures everything fresh each time. This ensures that anyone using the same Blueprint ends up with the same environment.

A Blueprint can configure:

-   **Core versions**: Specify which WordPress and PHP versions the site should use.
-   **Plugins and themes**: Define which should be installed and activated automatically.
-   **Site options**: Set values such as the site title, permalink structure, and other WordPress settings.
-   **Content**: Import demo posts, pages, or other starter content.
-   **Custom steps**: Run PHP or SQL commands during site creation to further customize the setup.

Blueprints in Studio follow the same format as [WordPress Playground](https://wordpress.org/playground/) Blueprints. That means a Blueprint you create for Studio can also be opened in Playground (and vice versa), making them portable across different development contexts.

## [Creating a Studio site from a Blueprint](#1-creating-a-studio-site-from-a-blueprint)

Creating local sites from Blueprints is incorporated into the site creation flow within Studio.

1.  Click the **Add site** (**+**) button at the top of the Studio sidebar. The following screen will appear.

[![The "Add a site" screen in WordPress Studio.](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site.png)

2.  Scroll down to **Start from a Blueprint** to see the Blueprints library, a search box, and an option to upload your own custom Blueprint file.

[![](https://developer.wordpress.com/wp-content/uploads/2025/10/blueprints-library.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/10/blueprints-library.png)

3.  Select a Blueprint that fits your needs, or click **Upload a Blueprint** and select the JSON file from your computer.
4.  On the setup screen, review the Blueprint, including the plugins it installs, and give your site a name. You can open **Advanced settings** for more options.
5.  Click **Create site from Blueprint**.

[![](https://developer.wordpress.com/wp-content/uploads/2025/10/create-site-from-blueprint.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/10/create-site-from-blueprint.png)

You can also drop a Blueprint file anywhere on the **Create a new site** screen, or click **upload a file** at the bottom of it.

A Blueprint that sets up a WordPress multisite requires a custom domain. When you pick one, the form shows “This Blueprint requires a custom domain.” and you need to enter a domain before you can create the site.

Behind the scenes, Studio builds the site from whichever Blueprint you selected or added. 

## [Featured Blueprints](#2-featured-blueprints)

Studio currently has three free featured Blueprints that you can use when setting up a new local site. They are listed first under **Start from a Blueprint**.

1.  **Theme & plugin development**: Designed for building themes and plugins, this Blueprint enables debug settings and includes tools like Query Monitor, Plugin Check, Theme Check, and Create Block Theme.
2.  **WordPress.com**: An environment that mirrors a WordPress.com site. It includes the Business plan plugins and themes you’d find pre-installed on WordPress.com, so you can spin up a production-like site right away.
3.  **WooCommerce**: Tailored for launching an online store, this Blueprint comes with WooCommerce and companion plugins pre-installed, along with optional extensions such as payment, advertising, and product listing tools. It provides a store-ready framework that you can extend for client projects.

The rest of the Blueprints library, built into the **Add a site** screen, offers a growing set of pre-configured sites for things like blogging, ecommerce, portfolios, and organizations. Use the **Search Blueprints** box to find one.

## [Building your own Blueprints](#3-building-your-own-blueprints)

Beyond the featured Blueprints, you can also create a custom JSON file to define your specific site requirements. For details on supported steps, JSON structure, and examples, refer to [How to create custom Blueprints](https://developer.wordpress.com/docs/guides/how-to-create-custom-blueprints/).

## [Opening Blueprints in Studio](#4-opening-blueprints-in-studio)

You can use a custom Blueprint when creating a new site in Studio, but you can also generate shareable links that open your Blueprint directly in the app (as long as the user has Studio installed). This makes it easy to share demos and examples that others can explore locally. Learn how to create your own links in the [Open in WordPress Studio button](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/open-in-wordpress-studio-button/).