import { getAgentServerPort as getPort } from './agent-server';
import { validateApiKey } from './anthropic-client';
import { saveApiKey, hasApiKey, removeApiKey, validateApiKeyFormat } from './api-key-storage';
import type { AgentStatus } from '../types';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * Get the agent server port.
 */
export async function getAgentServerPort( _event: IpcMainInvokeEvent ): Promise< number | null > {
	return getPort();
}

/**
 * Get the agent server status.
 */
export async function getAgentStatus( _event: IpcMainInvokeEvent ): Promise< AgentStatus > {
	const isConfigured = await hasApiKey();
	const serverPort = getPort();

	return {
		isConfigured,
		serverPort,
	};
}

/**
 * Configure the Anthropic API key.
 */
export async function configureAgentApiKey(
	_event: IpcMainInvokeEvent,
	apiKey: string
): Promise< { success: boolean; error?: string } > {
	if ( ! apiKey || typeof apiKey !== 'string' ) {
		return { success: false, error: 'API key is required' };
	}

	// Validate format
	if ( ! validateApiKeyFormat( apiKey ) ) {
		return {
			success: false,
			error: 'Invalid API key format. Anthropic API keys start with "sk-ant-"',
		};
	}

	// Validate the key works
	const isValid = await validateApiKey( apiKey );
	if ( ! isValid ) {
		return {
			success: false,
			error: 'API key validation failed. Please check your key and try again.',
		};
	}

	// Save the key
	await saveApiKey( apiKey );

	return { success: true };
}

/**
 * Remove the configured API key.
 */
export async function removeAgentApiKey(
	_event: IpcMainInvokeEvent
): Promise< { success: boolean } > {
	await removeApiKey();
	return { success: true };
}
