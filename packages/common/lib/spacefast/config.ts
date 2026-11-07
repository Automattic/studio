import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
	type SharedConfig,
} from '@studio/common/lib/shared-config';
import type { SpacefastAuth, SpacefastConnection } from '@studio/common/types/spacefast';

async function updateSpacefastConfig( update: ( config: SharedConfig ) => void ): Promise< void > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		update( config );
		await saveSharedConfig( config );
	} finally {
		await unlockSharedConfig();
	}
}

export async function readSpacefastAuth(): Promise< SpacefastAuth | null > {
	const { spacefastAuth } = await readSharedConfig();
	if ( ! spacefastAuth ) {
		return null;
	}
	if ( spacefastAuth.expiresAt && Date.parse( spacefastAuth.expiresAt ) <= Date.now() ) {
		return null;
	}
	return spacefastAuth;
}

export async function saveSpacefastAuth( auth: SpacefastAuth ): Promise< void > {
	await updateSpacefastConfig( ( config ) => {
		config.spacefastAuth = auth;
	} );
}

// Connections are kept: they only point at Spaces, and signing in again reuses them.
export async function clearSpacefastAuth(): Promise< void > {
	await updateSpacefastConfig( ( config ) => {
		delete config.spacefastAuth;
	} );
}

export async function getSpacefastConnection(
	localSiteId: string
): Promise< SpacefastConnection | null > {
	const { spacefastConnections } = await readSharedConfig();
	return spacefastConnections?.[ localSiteId ] ?? null;
}

export async function saveSpacefastConnection(
	localSiteId: string,
	connection: SpacefastConnection
): Promise< void > {
	await updateSpacefastConfig( ( config ) => {
		config.spacefastConnections = { ...config.spacefastConnections, [ localSiteId ]: connection };
	} );
}

export async function removeSpacefastConnection( localSiteId: string ): Promise< void > {
	await updateSpacefastConfig( ( config ) => {
		delete config.spacefastConnections?.[ localSiteId ];
	} );
}
