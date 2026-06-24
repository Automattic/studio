import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
	MAILPIT_HTTP_PORT_START,
	MAILPIT_SMTP_PORT_START,
	type MailpitConfig,
} from '@studio/common/lib/mailpit';
import { portFinder } from '@studio/common/lib/port-finder';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { ensureMailpitBinaryAvailable } from 'cli/lib/dependency-management/mailpit-binary';

function reserveConfiguredPorts( sites: SiteData[] ): void {
	for ( const site of sites ) {
		portFinder.addUnavailablePort( site.port );
		portFinder.addUnavailablePort( site.mailpit?.httpPort );
		portFinder.addUnavailablePort( site.mailpit?.smtpPort );
	}
}

async function createMailpitConfig( sites: SiteData[] ): Promise< MailpitConfig > {
	reserveConfiguredPorts( sites );

	const httpPort = await portFinder.getOpenPort( MAILPIT_HTTP_PORT_START );
	portFinder.addUnavailablePort( httpPort );

	const smtpPort = await portFinder.getOpenPort( MAILPIT_SMTP_PORT_START );
	portFinder.addUnavailablePort( smtpPort );

	return {
		enabled: true,
		httpPort,
		smtpPort,
	};
}

export async function ensureMailpitConfig( site: SiteData ): Promise< SiteData > {
	if ( site.mailpit?.enabled && site.mailpit.httpPort && site.mailpit.smtpPort ) {
		return site;
	}

	let locked = false;
	try {
		await lockCliConfig();
		locked = true;
		const config = await readCliConfig();
		const configuredSite = config.sites.find( ( candidate ) => candidate.id === site.id );

		if (
			configuredSite?.mailpit?.enabled &&
			configuredSite.mailpit.httpPort &&
			configuredSite.mailpit.smtpPort
		) {
			return { ...site, mailpit: configuredSite.mailpit };
		}

		const sitesForReservation = configuredSite ? config.sites : [ ...config.sites, site ];
		const mailpit = await createMailpitConfig( sitesForReservation );
		if ( configuredSite ) {
			configuredSite.mailpit = mailpit;
			await saveCliConfig( config );
		}

		return { ...site, mailpit };
	} finally {
		if ( locked ) {
			await unlockCliConfig();
		}
	}
}

function getMailpitDatabasePath( siteId: string ): string {
	const mailpitDataDir = path.join( getConfigDirectory(), 'mailpit' );
	fs.mkdirSync( mailpitDataDir, { recursive: true } );
	return path.join( mailpitDataDir, `${ siteId }.db` );
}

async function waitForMailpitReady( httpPort: number ): Promise< void > {
	const deadline = Date.now() + 5000;
	const url = `http://127.0.0.1:${ httpPort }/api/v1/info`;

	while ( Date.now() < deadline ) {
		try {
			const response = await fetch( url, { signal: AbortSignal.timeout( 500 ) } );
			if ( response.ok ) {
				return;
			}
		} catch {
			// Keep polling until MailPit accepts HTTP requests or the deadline expires.
		}

		await new Promise< void >( ( resolve ) => setTimeout( resolve, 100 ) );
	}

	throw new Error( `MailPit did not become ready at ${ url }` );
}

export async function startMailpit(
	site: Pick< SiteData, 'id' | 'name' | 'mailpit' >
): Promise< ChildProcess | null > {
	const mailpit = site.mailpit;
	if ( ! mailpit?.enabled ) {
		return null;
	}

	let binaryPath: string;
	try {
		binaryPath = await ensureMailpitBinaryAvailable();
	} catch ( error ) {
		console.warn(
			`MailPit binary unavailable; email catching is disabled. ${
				error instanceof Error ? error.message : String( error )
			}`
		);
		return null;
	}

	const child = spawn(
		binaryPath,
		[
			'--listen',
			`127.0.0.1:${ mailpit.httpPort }`,
			'--smtp',
			`127.0.0.1:${ mailpit.smtpPort }`,
			'--database',
			getMailpitDatabasePath( site.id ),
			'--disable-version-check',
		],
		{
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			windowsHide: true,
		}
	);

	child.stdout?.on( 'data', ( chunk ) => {
		console.log( `[MailPit ${ site.id }] ${ chunk.toString().trimEnd() }` );
	} );
	child.stderr?.on( 'data', ( chunk ) => {
		console.error( `[MailPit ${ site.id }] ${ chunk.toString().trimEnd() }` );
	} );

	try {
		await new Promise< void >( ( resolve, reject ) => {
			child.once( 'spawn', resolve );
			child.once( 'error', reject );
		} );
		await waitForMailpitReady( mailpit.httpPort );
		return child;
	} catch ( error ) {
		console.warn(
			`MailPit failed to start for site ${ site.id }: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
		if ( ! child.killed ) {
			child.kill( 'SIGKILL' );
		}
		return null;
	}
}

export function stopMailpit( child: ChildProcess | null ): void {
	if ( child && child.exitCode === null && child.signalCode === null && ! child.killed ) {
		child.kill( 'SIGTERM' );
	}
}
