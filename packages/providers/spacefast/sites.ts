import { __ } from '@wordpress/i18n';
import { ProviderNotReadyError, RemoteSiteError } from '../errors';
import { createSpace, listSpaces, listTeams, publishFiles, SpacefastApiError } from './api';
import { getVisibility, setVisibility } from './visibility';
import type { SpacefastConfig } from './config';
import type { Space } from './site';
import type { SitesService } from '../types';

function requireApiKey( config: SpacefastConfig | undefined ): string {
	if ( ! config?.apiKey ) {
		throw new ProviderNotReadyError( __( 'Connect Spacefast to publish sites.' ) );
	}
	return config.apiKey;
}

async function step< T >( message: string, code: string, run: () => Promise< T > ): Promise< T > {
	try {
		return await run();
	} catch ( error ) {
		if ( error instanceof ProviderNotReadyError ) {
			throw error;
		}
		if ( error instanceof SpacefastApiError && ( error.status === 401 || error.status === 403 ) ) {
			throw new ProviderNotReadyError(
				__( 'Your Spacefast sign-in no longer works. Connect Spacefast again.' )
			);
		}
		throw new RemoteSiteError(
			error instanceof SpacefastApiError ? `${ message }: ${ error.message }` : message,
			code,
			{ cause: error }
		);
	}
}

export const spacefastSites: SitesService< SpacefastConfig, Space > = {
	visibility: {
		get: ( config, id ) => getVisibility( requireApiKey( config ), id ),
		set: ( config, id, value ) => setVisibility( requireApiKey( config ), id, value ),
	},
	list: ( config ) =>
		step( __( 'Failed to load your Spacefast Spaces' ), 'site_fetch', () =>
			listSpaces( requireApiKey( config ) )
		),

	// In the account's first team: the one Spacefast creates with the account.
	create: ( config, { name } ) =>
		step( __( 'Failed to create the Space' ), 'site_create', async () => {
			const apiKey = requireApiKey( config );
			const [ team ] = await listTeams( apiKey );
			if ( ! team ) {
				throw new Error( 'The Spacefast account has no team.' );
			}
			return {
				...( await createSpace( apiKey, { teamId: team.id, title: name } ) ),
				teamName: team.name,
				teamSlug: team.slug,
			};
		} ),

	async push( config, site, content, _options, onStatus, signal ) {
		const apiKey = requireApiKey( config );
		if ( content.kind !== 'files' ) {
			throw new Error( 'Spacefast publishes a static export.' );
		}
		await step( __( 'Failed to publish to Spacefast' ), 'upload', () =>
			publishFiles(
				apiKey,
				site.id,
				content.files,
				( { stage, percent } ) =>
					onStatus(
						stage === 'uploading'
							? { phase: 'uploading', progress: percent }
							: { phase: 'finishing' }
					),
				signal
			)
		);
	},
};
