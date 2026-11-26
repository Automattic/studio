import { THINKING_LEVELS, type ThinkingLevel } from '@studio/providers';
import { __ } from '@wordpress/i18n';

// The level a chat runs at until it picks one, except on the user's own server, whose setting holds.
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

// What a chat can pick: a level, or the default for its model.
export const THINKING_SETTINGS = [ 'default', ...THINKING_LEVELS ] as const;
export type ThinkingSetting = ( typeof THINKING_SETTINGS )[ number ];

// `local`: the model runs on the user's server, whose own setting is the default; other models
// default to medium.
export const getThinkingOptions = (
	local = false
): Record< ThinkingSetting, { label: string; description: string } > => ( {
	default: {
		label: __( 'Default' ),
		description: local ? __( 'Your server’s setting' ) : __( 'Medium' ),
	},
	off: { label: __( 'Off' ), description: __( 'Answers right away, fastest' ) },
	low: { label: __( 'Low' ), description: __( 'Thinks briefly' ) },
	medium: { label: __( 'Medium' ), description: __( 'Thinks before answering' ) },
	high: { label: __( 'High' ), description: __( 'Thinks longest, slowest' ) },
} );
