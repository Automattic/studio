import { __ } from '@wordpress/i18n';
import type { GuideDefinition } from './guide';

// Keep these pages in step with the classic renderer's modal
// (apps/studio/src/modules/whats-new/components/whats-new-modal.tsx) — both are
// gated by the same FORCE_SHOW_WHATS_NEW switch in @studio/common.

export function getWhatsNewGuide(): GuideDefinition {
	return {
		pages: [
			{
				illustration: 'studio-code',
				title: () => __( 'Studio Code helps you get it done' ),
				description: () =>
					__(
						'From quick edits to new features, Studio Code helps you move faster by translating your ideas into working code.'
					),
				action: () => __( 'Next' ),
				learnMore: 'docsStudioCode',
			},
			{
				illustration: 'native-php',
				title: () => __( 'Faster local sites with native PHP' ),
				description: () =>
					__(
						'Studio now runs WordPress on native PHP by default — fewer abstractions, better performance. Switch between Native and Sandbox runtimes in your site settings.'
					),
				action: () => __( 'Next' ),
				learnMore: 'docsPhpRuntimes',
			},
			{
				illustration: 'dark-mode',
				title: () => __( 'Dark mode is here' ),
				description: () =>
					__(
						'Studio now supports light, dark, and system appearance modes. Head to Settings to choose your preferred look.'
					),
				action: () => __( 'Next' ),
			},
			{
				illustration: 'phpmyadmin',
				title: () => __( 'Manage your database with phpMyAdmin' ),
				description: () =>
					__(
						"Manage your site's database visually with phpMyAdmin, from the Database tab above the preview."
					),
				action: () => __( 'Next' ),
			},
			{
				illustration: 'cli',
				title: () => __( 'WP-CLI support and CLI site management' ),
				description: () =>
					__(
						'Install the studio CLI to run WP-CLI commands from your terminal and create, start, stop, or update your sites.'
					),
				action: () => __( 'Done' ),
				learnMore: 'docsCli',
			},
		],
	};
}
