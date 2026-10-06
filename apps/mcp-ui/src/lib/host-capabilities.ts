import type { HostCapabilities, HostContext } from '@/data/types';

const owns = ( value: unknown, key: string ) =>
	!! value && typeof value === 'object' && Object.prototype.hasOwnProperty.call( value, key );

// OpenAI hosts take a `_meta['openai/message']` target: send now, or draft a new chat.
export const canTargetMessages = ( capabilities: HostCapabilities ) =>
	owns( capabilities.experimental, 'openai/message' );

export const canMessage = ( capabilities: HostCapabilities ) =>
	canTargetMessages( capabilities ) || owns( capabilities, 'message' );

export const canAttach = ( capabilities: HostCapabilities ) =>
	owns( capabilities.experimental, 'openai/modelContext' ) ||
	owns( capabilities, 'updateModelContext' );

export const isPage = ( context: HostContext ) => context.displayMode === 'fullscreen';
