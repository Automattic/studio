import type { AgentCard } from '@a2a-js/sdk';

const DEFAULT_PORT = 41567;

export function getPort(): number {
	return parseInt( process.env.STUDIO_A2A_PORT ?? String( DEFAULT_PORT ), 10 );
}

export function buildAgentCard( port: number ): AgentCard {
	return {
		name: 'WordPress Studio Code',
		description:
			'AI agent for WordPress site management. Creates, configures, and designs local WordPress sites ' +
			'using WordPress Playground (PHP WASM). Capabilities include site creation with bold visual design, ' +
			'block-based content generation, WP-CLI execution, theme/plugin development, performance auditing, ' +
			'screenshot verification, and WordPress.com preview deployment.',
		url: `http://localhost:${ port }`,
		protocolVersion: '0.3.0',
		version: '1.0.0',
		provider: {
			organization: 'Automattic',
			url: 'https://developer.wordpress.com/studio/',
		},
		capabilities: {
			streaming: true,
			pushNotifications: false,
			stateTransitionHistory: true,
		},
		defaultInputModes: [ 'text' ],
		defaultOutputModes: [ 'text' ],
		skills: [
			{
				id: 'site-create',
				name: 'Create WordPress Site',
				description:
					'Create a new local WordPress site with a custom theme, bold visual design, ' +
					'block-based content, and scroll animations. Includes screenshot verification.',
				tags: [ 'wordpress', 'site', 'create', 'design', 'theme' ],
			},
			{
				id: 'site-manage',
				name: 'Manage WordPress Sites',
				description:
					'Start, stop, delete, list, and get info about local WordPress sites. ' +
					'Run WP-CLI commands. Import/export site backups.',
				tags: [ 'wordpress', 'site', 'manage', 'wp-cli' ],
			},
			{
				id: 'site-preview',
				name: 'WordPress.com Preview',
				description:
					'Deploy a local site as a hosted preview on WordPress.com. ' +
					'Create, update, list, and delete preview sites.',
				tags: [ 'wordpress', 'preview', 'deploy', 'wordpress.com' ],
			},
			{
				id: 'site-audit',
				name: 'Performance Audit',
				description:
					'Measure Core Web Vitals (TTFB, FCP, LCP, CLS), page weight, DOM size, ' +
					'and JS/CSS/image/font asset breakdown for a WordPress site.',
				tags: [ 'wordpress', 'performance', 'audit', 'web-vitals' ],
			},
			{
				id: 'site-screenshot',
				name: 'Screenshot',
				description:
					'Take full-page screenshots of a WordPress site in desktop (1040x1248) ' +
					'and mobile (390x844) viewports.',
				tags: [ 'wordpress', 'screenshot', 'visual' ],
			},
			{
				id: 'data-liberation',
				name: 'Data Liberation',
				description:
					'Migrate content from Wix, Squarespace, Webflow, or Shopify into a WordPress site. ' +
					'Extract, transform, and import content preserving structure and media.',
				tags: [ 'wordpress', 'migration', 'import', 'wix', 'squarespace', 'webflow', 'shopify' ],
			},
			{
				id: 'taxonomist',
				name: 'Taxonomy Optimizer',
				description:
					'Analyze and optimize WordPress categories and tags for better content organization.',
				tags: [ 'wordpress', 'taxonomy', 'categories', 'tags', 'seo' ],
			},
		],
	};
}
