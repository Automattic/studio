import { DRIVERS } from './hosts/drivers';
import { hostManifestSchema } from './hosts/manifest';
import type { RemoteHost } from '@studio/agent/node';

export function loadHosts( manifests: Record< string, unknown > ): Record< string, RemoteHost > {
	const hosts: Record< string, RemoteHost > = {};
	for ( const [ source, data ] of Object.entries( manifests ) ) {
		try {
			const manifest = hostManifestSchema.parse( data );
			const createDriver = Object.prototype.hasOwnProperty.call( DRIVERS, manifest.driver.type )
				? DRIVERS[ manifest.driver.type ]
				: undefined;
			if ( ! createDriver ) {
				throw new Error( `Unknown remote host driver: ${ manifest.driver.type }` );
			}
			if ( Object.prototype.hasOwnProperty.call( hosts, manifest.id ) ) {
				throw new Error( `Duplicate remote host ID: ${ manifest.id }` );
			}
			const driver = createDriver( manifest );
			Object.defineProperty( hosts, manifest.id, {
				enumerable: true,
				value: {
					...driver,
					name: manifest.name,
					sites: { ...driver.sites, listKey: manifest.sites.listKey },
					describeSite: ( site ) =>
						manifest.describeSite.replace( /\{(\w+)\}/g, ( _placeholder, field: string ) =>
							String( site[ field as keyof typeof site ] )
						),
				} satisfies RemoteHost,
			} );
		} catch ( error ) {
			throw new Error(
				`Invalid remote host manifest ${ source }: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
	return hosts;
}

export const HOSTS: Record< string, RemoteHost > = loadHosts(
	import.meta.glob( './hosts/*.json', { eager: true, import: 'default' } )
);
