import { __, sprintf } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import type { GuideDefinition, GuidePage } from './guide';

// Bump whenever the pages below change, so everyone sees the new ones once.
export const WHATS_NEW_VERSION = 1;

// Only when chat is on offer, like the tour's chat page.
function studioCodePage(): GuidePage {
	return {
		illustration: 'studio-code',
		title: () => __( 'Studio Code, right beside your site' ),
		description: () =>
			__(
				'Ask for a change and watch it land in the preview. Switch a chat to Live to work on your WordPress.com site.'
			),
		action: () => __( 'Next' ),
	};
}

export function getWhatsNewGuide( { chatEnabled }: { chatEnabled: boolean } ): GuideDefinition {
	return {
		pages: [
			{
				illustration: 'workspace',
				title: () => __( 'Meet the new WordPress Studio' ),
				description: () =>
					__(
						'Your sites and their chats now share one sidebar. Hide the chat when you want the preview to fill the window.'
					),
				action: () => __( 'Next' ),
			},
			...( chatEnabled ? [ studioCodePage() ] : [] ),
			{
				illustration: 'publish-share',
				title: () => __( 'Publish and share' ),
				description: () =>
					__(
						'Publish, at the top of the preview, replaces Sync: push your site to WordPress.com or pull changes back. Share sends anyone a preview link.'
					),
				action: () => __( 'Next' ),
			},
			{
				illustration: 'command-palette',
				title: () =>
					sprintf(
						/* translators: %s is the keyboard shortcut that opens the command palette, like ⌘K. */
						__( 'Press %s for anything' ),
						displayShortcut.primary( 'k' )
					),
				description: () =>
					__(
						'Jump to any site or chat, run a site action or change a setting from the keyboard.'
					),
				action: () => __( 'Next' ),
			},
			{
				illustration: 'appearance',
				title: () => __( 'Make it yours' ),
				description: () =>
					__( 'Choose an accent color, tint and contrast in Settings ▸ Appearance.' ),
				action: () => __( 'Done' ),
			},
		],
	};
}
