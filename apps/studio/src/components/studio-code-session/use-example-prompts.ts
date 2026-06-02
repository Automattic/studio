import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export interface ExamplePrompt {
	id: string;
	short: string;
	full: string;
}

/**
 * Example prompts shown on an empty Studio Code conversation.
 *
 * Defined as a hook (rather than a module-level constant) so the `__()` calls
 * are re-evaluated through `useI18n` whenever the user switches languages —
 * a top-level constant would be translated only once, at module load.
 */
export function useExamplePrompts(): ExamplePrompt[] {
	const { __ } = useI18n();

	return useMemo(
		() => [
			{
				id: 'build-a-plugin',
				short: __( 'Build a plugin' ),
				full: __(
					'Help me build a small WordPress plugin from scratch. Ask me what problem it should solve, scaffold the plugin folder and main file, then walk me through the hooks and code we need to wire it up.'
				),
			},
			{
				id: 'create-a-block',
				short: __( 'Create a block' ),
				full: __(
					'Help me create a custom Gutenberg block. Scaffold the block files, set up the edit and save components, and explain how to register it so I can see it in the editor.'
				),
			},
			{
				id: 'fix-an-error',
				short: __( 'Fix an error' ),
				full: __(
					'Something on my site is broken. Help me track down the error — check the logs, look at the relevant code, explain what is going wrong, and propose a fix.'
				),
			},
			{
				id: 'custom-post-type',
				short: __( 'Custom post type' ),
				full: __(
					'Add a custom post type to my site. Ask me what it is for, then register it with sensible labels and settings and show me where the code lives.'
				),
			},
			{
				id: 'tweak-my-theme',
				short: __( 'Tweak my theme' ),
				full: __(
					'Take a look at my active theme and suggest a few small improvements I could make to the design or layout, then help me implement one of them.'
				),
			},
			{
				id: 'explain-my-site',
				short: __( 'Explain my site' ),
				full: __(
					'Give me an overview of how this site is put together — the active theme, the installed plugins, and anything notable in the code — so I understand what I am working with.'
				),
			},
		],
		[ __ ]
	);
}
