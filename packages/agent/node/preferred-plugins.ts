// The plugins Studio recommends first for what core blocks leave out,
// declared once. The plugin-recommendations skill shows them as its table
// (renderPreferredPlugins(), kept in step by its test), and a check that finds
// markup a recommended block saves names that block. Which plugin a site gets
// stays the user's choice; these are the ones Studio offers first.

export interface PreferredPlugin {
	/** What the site needs, as the user would say it. */
	need: string;
	/** The plugin, or its feature, as the user knows it. */
	plugin: string;
	/** Its WordPress.org slug, and the module that turns the feature on. */
	install: string;
	/**
	 * The block that delivers the feature, the markup it replaces in a
	 * core/html block, and what it does that the markup does not.
	 */
	replaces?: { block: string; markup: string; pattern: RegExp; does?: string };
}

export const PREFERRED_PLUGINS: PreferredPlugin[] = [
	{
		need: 'To sell products — shop, store, storefront, catalog, prices',
		plugin: 'WooCommerce',
		install: '`woocommerce`',
	},
	{
		need: 'Contact, feedback, or multi-field forms',
		plugin: 'Jetpack Forms',
		install: '`jetpack`, `contact-form` module',
		replaces: {
			block: 'jetpack/contact-form',
			markup: 'form',
			pattern: /<(form|input|select|textarea|fieldset)\b/i,
			does: 'saves each submission, whatever its fields, as a Form Responses post (the feedback post type Contact_Form_Plugin registers in jetpack-forms), with or without a WordPress.com connection',
		},
	},
	{
		need: 'Email newsletter, subscribe form',
		plugin:
			'Jetpack Newsletter once the site is connected to WordPress.com; until then, a Jetpack Forms email form',
		install:
			'`jetpack`, `subscriptions` module, which needs a connection; until then `contact-form` module',
	},
	{
		need: 'Slideshow, carousel, tiled gallery, related posts, business hours, other non-core features',
		plugin: 'Jetpack blocks (`jetpack/slideshow`, `jetpack/tiled-gallery`, …)',
		install: '`jetpack`, `blocks` module',
	},
	{
		need: 'Social auto-sharing, stats, search, SEO meta',
		plugin: 'Jetpack modules',
		install: '`jetpack`',
	},
	{
		need: 'Online courses, lessons, quizzes',
		plugin: 'Sensei LMS',
		install: '`sensei-lms`',
	},
	{
		need: 'Polls, surveys, ratings, NPS, applause',
		plugin: 'Crowdsignal',
		install: '`crowdsignal-forms`',
	},
	{
		need: 'Comment and form spam protection',
		plugin: 'Akismet',
		install: 'bundled — recommend activating after deploy, not locally',
	},
];

/** The preferred plugins as the plugin-recommendations skill's table. */
export function renderPreferredPlugins(): string {
	return [
		'| The site needs… | Plugin | Install slug |',
		'| --- | --- | --- |',
		...PREFERRED_PLUGINS.map(
			( { need, plugin, install } ) => `| ${ need } | ${ plugin } | ${ install } |`
		),
	].join( '\n' );
}
