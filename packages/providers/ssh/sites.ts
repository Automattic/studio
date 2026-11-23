import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { RemoteSiteError } from '../errors';
import { formatSshAddress, parseSshAddress, parseSshHost, sshHostInput } from './address';
import { sshProvider, type SshSite } from './descriptor';
import { pullOverSsh } from './pull';
import { pushOverSsh } from './push';
import { inSite, runSsh, shellQuote, type SshConnection } from './shell';
import { addSshHost, listSshHosts } from './ssh-config';
import type { SitesServices } from '../types';

function connection( site: Pick< SshSite, 'id' > & Partial< SshSite > ): SshConnection {
	const target = parseSshAddress( site.id );
	if ( ! target || ! site.contentDir ) {
		throw new RemoteSiteError(
			__( 'Studio doesn’t know how to reach this site. Connect it again.' ),
			'ssh_probe'
		);
	}
	return { ...target, wpCli: site.wpCli ?? 'wp', contentDir: site.contentDir };
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

async function resolve( input: Record< string, string > ): Promise< SshSite > {
	const values = { host: '', path: '', wpCli: '', ...input };
	// A whole address as the host, as `--remote-site ssh:<address>` gives it.
	const address = values.path ? undefined : parseSshAddress( values.host );
	if ( address && ! /^\d+$/.test( address.path ) ) {
		values.host = address.port ? `${ address.destination }:${ address.port }` : address.destination;
		values.path = address.path;
	}
	const form = parseForm( sshProvider.sites!.connect!.input(), values );
	const server = parseSshAddress(
		formatSshAddress( { ...parseSshHost( form.host )!, path: form.path } )
	)!;
	const wpCli = form.wpCli.trim() || 'wp';
	const output = await runSsh(
		server,
		`${ inSite( { path: server.path, wpCli } ) }\nstudio_wp eval ${ shellQuote( PROBE ) }`,
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
		wpCli,
		contentDir: probe.contentDir,
	};
}

export const sshSites: SitesServices< undefined, SshSite > = {
	// The connections are the sites: the user connects each one.
	list: async () => [],
	resolve: ( _config, input ) => resolve( input ),
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
