# WordPress Studio CLI

The standalone, CLI-only version of [WordPress Studio](https://developer.wordpress.com/studio/).

- Create, run, and manage local WordPress sites from the terminal.
- Run WP-CLI commands.
- Publish ephemeral preview sites to share (requires WordPress.com login).

## Install

Run without installing:

```bash
npx @automattic/wp-studio@latest --help
```

Install globally:

```bash
npm install -g @automattic/wp-studio
studio --help
```

## Quick start

Create a site (with a step-by-step guide):

```bash
studio site create
```

List sites:

```bash
studio site list
```

Start / stop a site:

```bash
studio site start --path ~/Studio/my-site
studio site stop --path ~/Studio/my-site
```

Run WP-CLI in a site:

```bash
studio wp plugin list --path ~/Studio/my-site
studio wp option get home --path ~/Studio/my-site
```

To publish preview sites, you need to first authenticate with WordPress.com:

```bash
studio auth login
```

Publish a preview site: 

```bash
studio preview create --path ~/Studio/my-site
```
