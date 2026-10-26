/**
 * @vitest-environment node
 *
 * Email a site sends is saved, unchanged, as an `.eml` file in that site's email
 * folder, whether a page request sends it (WordPress's lost-password form) or WP-CLI
 * does. `site status` names the folder, and deleting the site removes it.
 *
 * Needs the CLI built first (skips otherwise). Tagged `e2e`:
 * `npm test -- --tagsFilter='e2e'`.
 */
import fs from 'fs';
import os from 'os';
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

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: site email', () => {
	let env: CliEnv | undefined;
	let sitePath = '';
	let siteUrl = '';

	async function createSite( name: string, folder: string ) {
		const result = await runCli(
			[
				'site',
				'create',
				'--name',
				name,
				'--path',
				folder,
				'--wp',
				'latest',
				'--skip-browser',
				'--skip-log-details',
			],
			env!
		);
		expect( result.code, result.stderr ).toBe( 0 );
	}

	// The folder `site status` names for a site, and the messages saved in it.
	async function emailOf( folder: string ) {
		const status = await runCli( [ 'site', 'status', '--path', folder, '--format', 'json' ], env! );
		expect( status.code, status.stderr ).toBe( 0 );
		const directory = JSON.parse( status.stdout ).emailPath.replace( /^~/, os.homedir() );
		const files = fs.existsSync( directory )
			? fs
					.readdirSync( directory )
					.filter( ( file ) => file.endsWith( '.eml' ) )
					.sort()
			: [];
		const messages = files.map( ( file ) =>
			fs.readFileSync( path.join( directory, file ), 'utf8' )
		);
		const subjects = messages
			.map( ( message ) => /^Subject: (.*)$/m.exec( message )?.[ 1 ] )
			.sort();
		return { directory, messages, subjects };
	}

	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'email-e2e-site' );
		await createSite( 'Email E2E Site', sitePath );
		const site = readCliConfig( env ).sites.find( ( s ) => s.path === sitePath );
		siteUrl = `http://localhost:${ String( site?.port ) }`;
	}, 300_000 );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
		env = undefined;
	}, 60_000 );

	it(
		'saves email sent by a page and by WP-CLI',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
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
				env!
			);
			expect( sent.stdout, sent.stderr ).toContain( 'SENT' );

			const { messages, subjects } = await emailOf( sitePath );
			expect( subjects ).toEqual( [ 'Order received', '[Email E2E Site] Password Reset' ] );
			const order = messages.find( ( message ) => message.includes( 'Subject: Order received' ) )!;
			expect( {
				to: /^To: (.*)$/m.exec( order )?.[ 1 ],
				cc: /^Cc: (.*)$/m.exec( order )?.[ 1 ],
				replyTo: /^Reply-To: (.*)$/m.exec( order )?.[ 1 ],
				html: order.includes( '<p>Thanks for your <b>order</b></p>' ),
				attachment: order.includes( Buffer.from( 'attached bytes' ).toString( 'base64' ) ),
			} ).toEqual( {
				to: 'a@example.com, b@example.com',
				cc: 'Carol <carol@example.com>',
				replyTo: 'shop@example.com',
				html: true,
				attachment: true,
			} );
		}
	);

	it(
		"keeps each site's email apart, keeps the newest 100, and deletes them with the site",
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			const otherPath = path.join( env!.sitesDir, 'email-e2e-other' );
			await createSite( 'Other Site', otherPath );
			// A site that already has 100 messages.
			const { directory } = await emailOf( otherPath );
			fs.mkdirSync( directory, { recursive: true } );
			for ( let i = 0; i < 100; i++ ) {
				const name = `20000101-000000-${ String( i ).padStart( 6, '0' ) }-old.eml`;
				fs.writeFileSync( path.join( directory, name ), `Subject: Old ${ i }\n\nOld` );
			}
			const sent = await runCli(
				[ 'wp', '--path', otherPath, 'eval', "wp_mail( 'c@example.com', 'Shop email', 'Hi' );" ],
				env!
			);
			expect( sent.code, sent.stderr ).toBe( 0 );

			const other = await emailOf( otherPath );
			expect( {
				first: ( await emailOf( sitePath ) ).subjects,
				otherCount: other.subjects.length,
				otherHasNewest: other.subjects.includes( 'Shop email' ),
				otherHasOldest: other.subjects.includes( 'Old 0' ),
			} ).toEqual( {
				first: [ 'Order received', '[Email E2E Site] Password Reset' ],
				otherCount: 100,
				otherHasNewest: true,
				otherHasOldest: false,
			} );

			const deleted = await runCli( [ 'site', 'delete', '--path', otherPath ], env! );
			expect( deleted.code, deleted.stderr ).toBe( 0 );
			expect( fs.existsSync( other.directory ) ).toBe( false );
		}
	);
} );
