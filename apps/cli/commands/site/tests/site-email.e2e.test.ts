/**
 * @vitest-environment node
 *
 * Email a site sends lands in Studio's inbox, whether a page request sends it
 * (WordPress's lost-password form) or WP-CLI does, and arrives unchanged.
 *
 * Needs the CLI built first (skips otherwise). Tagged `e2e`:
 * `npm test -- --tagsFilter='e2e'`.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	type CliEnv,
} from './helpers/cli-e2e';

type InboxMessage = {
	ID: string;
	Subject: string;
	From: { Address: string };
	To: Array< { Address: string } >;
	Cc: Array< { Address: string } > | null;
	ReplyTo: Array< { Address: string } >;
};

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: site email', () => {
	let env: CliEnv | undefined;
	let sitePath = '';
	let siteUrl = '';
	let inboxUrl = '';

	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'email-e2e-site' );
		const result = await runCli(
			[
				'site',
				'create',
				'--name',
				'Email E2E Site',
				'--path',
				sitePath,
				'--wp',
				'latest',
				'--skip-browser',
				'--skip-log-details',
			],
			env
		);
		expect( result.code, result.stderr ).toBe( 0 );
		const site = readCliConfig( env ).sites.find( ( s ) => s.path === sitePath );
		siteUrl = `http://localhost:${ String( site?.port ) }`;
		const ports = JSON.parse( fs.readFileSync( portsPath(), 'utf8' ) );
		inboxUrl = `http://127.0.0.1:${ String( ports.httpPort ) }`;
	}, 300_000 );

	const portsPath = () => path.join( env!.configDir, 'mailpit', 'ports.json' );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
		env = undefined;
	}, 60_000 );

	async function inbox(): Promise< InboxMessage[] > {
		const response = await fetch( `${ inboxUrl }/api/v1/messages` );
		return ( await response.json() ).messages ?? [];
	}

	it(
		'catches email sent by a page and by WP-CLI',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			if ( ! env ) {
				throw new Error( 'CLI e2e env was not initialised' );
			}

			const lostPassword = await fetch( `${ siteUrl }/wp-login.php?action=lostpassword`, {
				method: 'POST',
				body: new URLSearchParams( { user_login: 'admin', redirect_to: '' } ),
				redirect: 'manual',
			} );
			// WordPress redirects to `checkemail=confirm` only once the email is sent.
			expect(
				lostPassword.headers.get( 'location' ) ?? `no redirect: HTTP ${ lostPassword.status }`
			).toContain( 'checkemail=confirm' );

			fs.writeFileSync( path.join( sitePath, 'note.txt' ), 'attached bytes' );
			const sent = await runCli(
				[
					'wp',
					'--path',
					sitePath,
					'eval',
					`echo wp_mail(
					array( 'a@example.com', 'b@example.com' ),
					'Order received',
					'<p>Thanks for your <b>order</b></p>',
					array( 'Content-Type: text/html; charset=UTF-8', 'Cc: Carol <carol@example.com>', 'Reply-To: shop@example.com' ),
					array( ABSPATH . 'note.txt' )
				) ? 'SENT' : 'FAILED';`,
				],
				env
			);
			expect( sent.stdout, sent.stderr ).toContain( 'SENT' );

			const messages = await inbox();
			expect( messages.map( ( m ) => m.Subject ).sort() ).toEqual( [
				'Order received',
				'[Email E2E Site] Password Reset',
			] );

			const order = messages.find( ( m ) => m.Subject === 'Order received' )!;
			expect( {
				to: order.To.map( ( t ) => t.Address ),
				cc: order.Cc?.map( ( t ) => t.Address ),
				replyTo: order.ReplyTo.map( ( t ) => t.Address ),
			} ).toEqual( {
				to: [ 'a@example.com', 'b@example.com' ],
				cc: [ 'carol@example.com' ],
				replyTo: [ 'shop@example.com' ],
			} );
			const message = await ( await fetch( `${ inboxUrl }/api/v1/message/${ order.ID }` ) ).json();
			expect( message.HTML.trim() ).toBe( '<p>Thanks for your <b>order</b></p>' );
			const attachment = await fetch(
				`${ inboxUrl }/api/v1/message/${ order.ID }/part/${ message.Attachments[ 0 ].PartID }`
			);
			expect( await attachment.text() ).toBe( 'attached bytes' );
		}
	);

	it(
		'stops the inbox with the last site, keeping its mail',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			if ( ! env ) {
				throw new Error( 'CLI e2e env was not initialised' );
			}

			const stopped = await runCli( [ 'site', 'stop', '--path', sitePath ], env );
			expect( stopped.code, stopped.stderr ).toBe( 0 );
			// No site sends email to a stopped inbox.
			expect( fs.existsSync( portsPath() ) ).toBe( false );
			await expect( fetch( `${ inboxUrl }/api/v1/info` ) ).rejects.toThrow();

			const started = await runCli(
				[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
				env
			);
			expect( started.code, started.stderr ).toBe( 0 );
			const ports = JSON.parse( fs.readFileSync( portsPath(), 'utf8' ) );
			inboxUrl = `http://127.0.0.1:${ String( ports.httpPort ) }`;
			expect( ( await inbox() ).length ).toBe( 2 );
		}
	);
} );
