import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { RemoteSiteError } from '../errors';
import { formatSshAddress, parseSshAddress, parseSshHost, sitePath, sshHostInput } from './address';
import { sshProvider, type SshSite } from './descriptor';
import { pullOverSsh } from './pull';
import { pushOverSsh } from './push';
import { inSite, shellQuote, uploadWpCli, withSsh, type SshConnection } from './shell';
import { addSshHost, listSshHosts } from './ssh-config';
import type { ResolveFrom, SitesServices } from '../types';

function connection( site: Pick< SshSite, 'id' > & Partial< SshSite > ): SshConnection {
	const target = parseSshAddress( site.id );
	if ( ! target || ! site.contentDir ) {
		throw new RemoteSiteError(
			__( 'Studio doesn’t know how to reach this site. Connect it again.' ),
			'ssh_probe'
		);
	}
	return { ...target, php: site.php || 'php', contentDir: site.contentDir };
}

const PROBE = `echo json_encode( array(
	'home' => home_url(),
	'name' => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
	'contentDir' => WP_CONTENT_DIR,
	'multisite' => is_multisite(),
) );`;

function parseForm< Schema extends z.ZodType >(
	schema: Schema,
	input: unknown
): z.infer< Schema > {
	const form = schema.safeParse( input );
	if ( ! form.success ) {
		throw new RemoteSiteError( form.error.issues[ 0 ].message, 'ssh_address' );
	}
	return form.data;
}

// The form's values for a site's address.
function addressValues( id: string ): Record< string, string > {
	const address = parseSshAddress( id );
	if ( ! address ) {
		return { host: id };
	}
	const { destination, port, path } = address;
	return { host: port ? `${ destination }:${ port }` : destination, path };
}

async function resolve( from: ResolveFrom ): Promise< SshSite > {
	const values = {
		host: '',
		path: '',
		php: '',
		...( 'id' in from ? addressValues( from.id ) : from.input ),
	};
	const form = parseForm( sshProvider.sites!.connect!.input(), values );
	const server = { ...parseSshHost( form.host )!, path: sitePath( form.path ) };
	const php = form.php.trim();
	const output = await withSsh(
		server,
		async ( ssh ) => {
			const site = { ...server, php: php || 'php' };
			const wpCli = await uploadWpCli( ssh, site );
			return ssh.run( `${ inSite( site, wpCli ) }\nstudio_wp eval ${ shellQuote( PROBE ) }` );
		},
		{ acceptNewHostKey: true }
	);
	// Plugins and the server's shell may print before the JSON.
	const line = output
		.trim()
		.split( '\n' )
		.reverse()
		.find( ( candidate ) => candidate.startsWith( '{' ) );
	let probe: { home?: string; name: string; contentDir: string; multisite: boolean } | undefined;
	try {
		probe = line ? JSON.parse( line ) : undefined;
	} catch {
		// Reported below.
	}
	if ( ! probe?.home || ! /^https?:\/\//.test( probe.home ) ) {
		throw new RemoteSiteError(
			sprintf( __( 'Could not read the WordPress site in %s.' ), server.path ),
			'ssh_probe'
		);
	}
	if ( probe.multisite ) {
		throw new RemoteSiteError(
			__( 'Studio can’t push to or pull from a multisite network yet.' ),
			'ssh_multisite'
		);
	}
	return {
		id: formatSshAddress( server ),
		name: probe.name || new URL( probe.home ).hostname,
		url: probe.home,
		...( php ? { php } : {} ),
		contentDir: probe.contentDir,
	};
}

export const sshSites: SitesServices< undefined, SshSite > = {
	// The connections are the sites: the user connects each one.
	list: async () => [],
	resolve: ( _config, from ) => resolve( from ),
	action: async ( _config, name, input ) => {
		if ( name === 'hosts' ) {
			return listSshHosts();
		}
		if ( name === 'addHost' ) {
			return addSshHost( parseForm( sshHostInput(), { port: '', key: '', ...input } ) );
		}
		throw new Error( `SSH has no ${ name } action.` );
	},
	push: ( _config, site, content, _options, onStatus, signal ) =>
		pushOverSsh( connection( site ), content, onStatus, signal ),
	pullArchive: ( _config, site, options, archive, onProgress, signal ) =>
		pullOverSsh( connection( site ), options, archive, onProgress, signal ),
};
