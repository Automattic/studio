/// <reference types="vite/client" />
import type { ProviderConfigs, ProviderId, ProviderSite } from './registry';
import type { ProviderServices } from './types';

// Each provider folder's `services.ts`, by its path, with what it exports as `services`, which a
// module that doesn't export it leaves undefined. Vitest caches a transformed module across runs
// unless it calls `import.meta.glob(` literally, so a type argument here would keep a stale list
// of folders.
const MODULES = Object.entries(
	import.meta.glob( './*/services.ts', { eager: true, import: 'services' } ) as Record<
		string,
		ProviderServices | undefined
	>
);

export function getProviderServices< Id extends ProviderId >(
	id: Id
): ProviderServices< ProviderConfigs[ Id ], ProviderSite< Id > > {
	const services = MODULES.find( ( [ , candidate ] ) => candidate?.id === id )?.[ 1 ];
	if ( ! services ) {
		const unread = MODULES.filter( ( [ , candidate ] ) => ! candidate ).map( ( [ path ] ) =>
			path.slice( 2 )
		);
		throw new Error(
			`The ${ id } provider has no services: its folder's services.ts exports them as \`services\`, from defineServices().${
				unread.length ? ` These export no \`services\`: ${ unread.join( ', ' ) }.` : ''
			}`
		);
	}
	return services as ProviderServices< ProviderConfigs[ Id ], ProviderSite< Id > >;
}

// Previews upload to WordPress.com the way a push does, until they are a capability of their own.
export { createTusUpload } from './wpcom/sites/upload';
