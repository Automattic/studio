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

1.  Click the **Add site** (**+**) button next to **Sites** at the top of the Studio sidebar. The **Add site** dialog opens on **Create**, which shows **Blank site** and the Blueprints library under **Create a new WordPress**.

[![The Add site dialog in WordPress Studio, open on Create, showing Create a new WordPress with a Blank site card and Blueprint cards such as Wedding RSVP, Stylish Press, and University Website, and categories under By use case on the left.](https://developer.wordpress.com/wp-content/uploads/2025/10/add-site.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/10/add-site.webp)

2.  Browse the Blueprints library, or pick a category under **By use case** on the left: **Business**, **Blog**, **Portfolio**, **Store**, **Events**, or **Development**.

[![The Business category of the Blueprints library in Studio's Add site dialog, showing the University Website, Non-profit Organization, and Quick Start Blueprints.](https://developer.wordpress.com/wp-content/uploads/2025/10/blueprints-library.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/10/blueprints-library.webp)

3.  Click a Blueprint to see a larger preview. Click **Preview in browser** to try it out first. To go back to the library, click **Blueprints** at the top of the dialog.
4.  Click **Create site**. Studio creates the site with the Blueprint’s name, in your default site folder. If the Blueprint needs more information, such as a custom domain, or the folder isn’t empty, Studio shows the **Create your site** form first: review the Blueprint, including the plugins and themes it installs, give your site a name, and click **Create site from Blueprint**.

[![A larger preview of the University Website Blueprint in Studio's Add site dialog, with Preview in browser and Create site buttons at the top.](https://developer.wordpress.com/wp-content/uploads/2025/10/blueprint-details.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/10/blueprint-details.webp)

To use your own Blueprint:

1.  In the **Add site** dialog, choose **Upload**. The **Upload a Blueprint** screen opens.
2.  Drop a Blueprint file (a `.json` file or a `.zip` bundle) on the **Drop a Blueprint here** area, or click **Choose file** and select it.
3.  The **Create your site** form opens and shows the Blueprint. Give your site a name and click **Create site from Blueprint**.

[![The Upload a Blueprint screen in Studio's Add site dialog, with Upload selected on the left and a Drop a Blueprint here area that supports Blueprint JSON files and ZIP bundles, with a Choose file button.](https://developer.wordpress.com/wp-content/uploads/2025/10/add-site-upload.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/10/add-site-upload.webp)

To use a blank site instead, click **Remove** next to the Blueprint.

A Blueprint that sets up a WordPress multisite requires a custom domain. When you pick one, the form shows “This Blueprint requires a custom domain.” and you need to enter a domain before you can create the site.

Behind the scenes, Studio builds the site from whichever Blueprint you selected or added. 

## [Featured Blueprints](#2-featured-blueprints)

Studio currently has three free featured Blueprints that you can use when setting up a new local site. Find them in the Blueprints library in the **Add site** dialog.

1.  **Theme & plugin development**: Designed for building themes and plugins, this Blueprint enables debug settings and includes tools like Query Monitor, Plugin Check, Theme Check, and Create Block Theme.
2.  **WordPress.com**: An environment that mirrors a WordPress.com site. It includes the Business plan plugins and themes you’d find pre-installed on WordPress.com, so you can spin up a production-like site right away.
3.  **WooCommerce**: Tailored for launching an online store, this Blueprint comes with WooCommerce and companion plugins pre-installed, along with optional extensions such as payment, advertising, and product listing tools. It provides a store-ready framework that you can extend for client projects.

The rest of the Blueprints library, built into the **Add site** dialog, offers a growing set of pre-configured sites for things like blogging, ecommerce, portfolios, and organizations. Use the categories under **By use case** on the left of the dialog to find one.

## [Building your own Blueprints](#3-building-your-own-blueprints)

Beyond the featured Blueprints, you can also create a custom JSON file to define your specific site requirements. For details on supported steps, JSON structure, and examples, refer to [How to create custom Blueprints](https://developer.wordpress.com/docs/guides/how-to-create-custom-blueprints/).

## [Opening Blueprints in Studio](#4-opening-blueprints-in-studio)

You can use a custom Blueprint when creating a new site in Studio, but you can also generate shareable links that open your Blueprint directly in the app (as long as the user has Studio installed). This makes it easy to share demos and examples that others can explore locally. Learn how to create your own links in the [Open in WordPress Studio button](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/open-in-wordpress-studio-button/).