import { spawn } from 'child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { closeSharedBrowser, getSharedBrowser } from '@studio/agent/node/browser-utils';
import { FormCheck } from '@studio/agent/node/form-check';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { liveHost } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';
import type { ChildProcess } from 'child_process';

// A real WordPress install, as `wp core install` left it, when one is given,
// and a real Chromium to send its forms from.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;
const CHROMIUM = existsSync( chromium.executablePath() );
// An unzipped Jetpack plugin, when one is given.
const JETPACK = process.env.STUDIO_TEST_JETPACK;

const ROUTER = path.resolve( import.meta.dirname, '../../php/router.php' );
const SENDMAIL = path.resolve( import.meta.dirname, '../../php/sendmail.php' );

// A site's own code: an enquiry form's handler that saves each enquiry as a
// post with its meta and emails it, as a theme's or plugin's form does.
const ENQUIRIES = `<?php
add_action( 'init', function () {
	register_post_type( 'enquiry', array( 'public' => false ) );
	if ( isset( $_POST['studio_enquiry'] ) ) {
		$message = sanitize_textarea_field( wp_unslash( $_POST['message'] ) );
		$id      = wp_insert_post( array( 'post_type' => 'enquiry', 'post_status' => 'publish', 'post_title' => sanitize_text_field( wp_unslash( $_POST['your_name'] ) ), 'post_content' => $message ) );
		add_post_meta( $id, 'enquiry_email', sanitize_email( wp_unslash( $_POST['email'] ) ) );
		wp_mail( get_option( 'admin_email' ), 'New enquiry', $message );
		wp_safe_redirect( add_query_arg( 'sent', '1', wp_get_referer() ) );
		exit;
	}
} );
add_filter( 'the_content', function ( $content ) {
	return isset( $_GET['sent'] ) ? '<p>Thanks, we will be in touch.</p>' . $content : $content;
} );
`;

// A form that stores and emails what is typed, beside a search form, which is no visitor's message.
const STORING = `<!-- wp:html -->
<form role="search" method="post" action="/"><input type="text" name="q" aria-label="Search"></form>
<form method="post"><input type="hidden" name="studio_enquiry" value="1">
<label for="n">Your name</label><input id="n" type="text" name="your_name" required>
<label for="e">Email</label><input id="e" type="email" name="email" required>
<label for="m">Message</label><textarea id="m" name="message" required></textarea>
<button type="submit">Send enquiry</button></form>
<!-- /wp:html -->`;

// A form that posts to its page, which nothing on the site handles.
const NOWHERE = `<!-- wp:html -->
<form method="post"><label for="n">Name</label><input id="n" type="text" name="guest">
<label for="m">Message</label><textarea id="m" name="note"></textarea>
<button type="submit">Book a table</button></form>
<!-- /wp:html -->`;

// A form whose markup asks for a code a visitor's name does not match.
const PATTERN = `<!-- wp:html -->
<form method="post"><input type="hidden" name="studio_enquiry" value="1">
<label for="n">Your name</label><input id="n" type="text" name="your_name" pattern="[0-9]{5}" required>
<label for="m">Message</label><textarea id="m" name="message"></textarea>
<button type="submit">Join the list</button></form>
<!-- /wp:html -->`;

// A form whose script refuses to send it and says why.
const SCRIPTED = `<!-- wp:html -->
<form method="post" novalidate id="slots"><label for="m">Message</label><textarea id="m" name="message"></textarea>
<p class="form-error" hidden></p><button type="submit">Reserve</button></form>
<script>document.getElementById( 'slots' ).addEventListener( 'submit', function ( event ) {
	event.preventDefault();
	var error = this.querySelector( '.form-error' );
	error.textContent = 'Please choose a delivery slot.';
	error.hidden = false;
} );</script>
<!-- /wp:html -->`;

// A form that sends to WordPress.com, and one that sends to another service.
const OFF_SITE = `<!-- wp:html -->
<form method="post" action="https://subscribe.wordpress.com/"><label for="e">Email</label><input id="e" type="email" name="email">
<button type="submit">Subscribe</button></form>
<form method="post" action="https://example.org/lists/join"><label for="f">Email</label><input id="f" type="email" name="address">
<button type="submit">Join</button></form>
<!-- /wp:html -->`;

// A Jetpack Forms contact form.
const JETPACK_FORM = `<!-- wp:jetpack/contact-form {"subject":"New enquiry"} -->
<div class="wp-block-jetpack-contact-form"><!-- wp:jetpack/field-name {"required":true} /-->
<!-- wp:jetpack/field-email {"required":true} /-->
<!-- wp:jetpack/field-textarea /-->
<!-- wp:jetpack/button {"element":"button","text":"Contact us"} /--></div>
<!-- /wp:jetpack/contact-form -->`;

const freePort = () =>
	new Promise< number >( ( resolve ) => {
		const server = net.createServer();
		server.listen( 0, '127.0.0.1', () => {
			const { port } = server.address() as net.AddressInfo;
			server.close( () => resolve( port ) );
		} );
	} );

describe.runIf( WORDPRESS && CHROMIUM )( 'the turn-end check of the forms a visitor sends', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	let server: ChildProcess;
	let config: string;
	let emailDir: string;
	const configWas = process.env.DEV_CONFIG_DIR;

	const query = async ( sql: string ) => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ), {
			timeout: 10000,
		} );
		try {
			return db.prepare( sql ).all();
		} finally {
			db.close();
		}
	};
	const wp = async ( ...args: string[] ) => {
		const result = await host.sites.wpCli( site, args );
		expect( result.stderr ).not.toMatch( /Error:/ );
		return result.stdout.trim();
	};
	const page = ( title: string, content: string ) =>
		wp(
			'post',
			'create',
			'--user=1',
			'--post_type=page',
			'--post_status=publish',
			`--post_title=${ title }`,
			`--post_content=${ content }`,
			'--porcelain'
		);
	const emails = () =>
		existsSync( emailDir )
			? readdirSync( emailDir ).filter( ( name ) => name.endsWith( '.eml' ) )
			: [];

	beforeAll( () => {
		config = mkdtempSync( path.join( os.tmpdir(), 'form-check-config-' ) );
		process.env.DEV_CONFIG_DIR = config;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		process.env.DEV_CONFIG_DIR = configWas;
		rmSync( config, { recursive: true, force: true } );
	} );
	beforeEach( async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'form-check-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		mkdirSync( path.join( root, 'wp-content/mu-plugins' ), { recursive: true } );
		writeFileSync( path.join( root, 'wp-content/mu-plugins/enquiries.php' ), ENQUIRIES );
		const port = await freePort();
		site = {
			id: path.basename( root ),
			name: 'Form Site',
			path: root,
			url: `http://127.0.0.1:${ port }`,
			phpVersion: '8.3',
		};
		emailDir = getSiteEmailDirectory( site.id );
		const live = liveHost( site );
		host = { ...live, sites: { ...live.sites, isRunning: async () => true } };
		await wp( 'option', 'update', 'home', site.url );
		await wp( 'option', 'update', 'siteurl', site.url );
		server = spawn(
			'php',
			[
				'-d',
				`sendmail_path="php -n ${ SENDMAIL } ${ emailDir }"`,
				'-S',
				`127.0.0.1:${ port }`,
				'-t',
				root,
				ROUTER,
			],
			{ cwd: root, stdio: 'ignore' }
		);
		for ( let tries = 0; tries < 50; tries++ ) {
			if (
				await fetch( site.url ).then(
					() => true,
					() => false
				)
			)
				break;
			await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );
		}
	}, 60000 );
	afterEach( () => {
		server.kill();
		rmSync( site.path, { recursive: true, force: true } );
	} );

	// The check a turn's calls on the site end with, and the problem it records.
	const checkTurn = async (
		change: () => Promise< unknown >,
		newPage?: ConstructorParameters< typeof FormCheck >[ 2 ]
	) => {
		const open = new OpenProblems( [] );
		const check = new FormCheck( host, open, newPage );
		await change();
		check.changed( site.path );
		const started = Date.now();
		await check.check();
		const took = Date.now() - started;
		return { problems: await open.raise(), took, check, open };
	};

	it( 'says nothing of a form that stores what a visitor types, and removes the test submission', async () => {
		const enquiriesBefore = await query( "SELECT ID FROM wp_posts WHERE post_type = 'enquiry'" );
		const { problems, took } = await checkTurn( () => page( 'Contact', STORING ) );
		console.warn( `storing form checked in ${ took }ms` );

		expect( problems ).toEqual( [] );
		expect( enquiriesBefore ).toEqual( [] );
		expect( await query( "SELECT ID FROM wp_posts WHERE post_type = 'enquiry'" ) ).toEqual( [] );
		expect(
			await query( "SELECT meta_id FROM wp_postmeta WHERE meta_key = 'enquiry_email'" )
		).toEqual( [] );
		expect( emails() ).toEqual( [] );
		expect( await query( "SELECT ID FROM wp_posts WHERE post_title = 'Contact'" ) ).toHaveLength(
			1
		);
	}, 120000 );

	it( 'reports a form that stores what a visitor types nowhere', async () => {
		const { problems, took } = await checkTurn( () => page( 'Book', NOWHERE ) );
		console.warn( `nowhere form checked in ${ took }ms` );

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toContain(
			'Studio filled in the forms a visitor sends on the pages this turn changed'
		);
		expect( problems[ 0 ] ).toMatch(
			/- \/\?page_id=\d+, the form whose button reads "Book a table": WordPress stored what was typed nowhere; no post of any type, post meta, option, comment or other row of the site's database holds it, and the site sent no email \(Studio saves each one wp_mail\(\) sends\)\. The page then showed nothing new\.$/
		);
		expect( problems[ 0 ] ).not.toMatch( /stays in|studio-test-/ );
	}, 120000 );

	it( 'reports a form the browser will not send, quoting what it shows', async () => {
		const { problems } = await checkTurn( () => page( 'Join', PATTERN ) );

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toMatch(
			/the form whose button reads "Join the list": the browser did not send it; its "Your name" field fails the constraints its markup sets \(HTMLFormElement\.checkValidity\(\)\), and the browser showed "Please match the requested format\.". Studio typed Your name "Test Visitor", Message "a test message"\./
		);
		expect( await query( "SELECT ID FROM wp_posts WHERE post_type = 'enquiry'" ) ).toEqual( [] );
	}, 120000 );

	it( "reports a form the page's script will not send, quoting what it shows", async () => {
		const { problems } = await checkTurn( () => page( 'Reserve', SCRIPTED ) );

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toContain(
			`the form whose button reads "Reserve": the page's script kept it from sending and showed "Please choose a delivery slot.". Studio typed Message "a test message".`
		);
	}, 120000 );

	it( 'reports a form that sends to WordPress.com from a site not connected to it, and sends nothing off the site', async () => {
		// The requests that went off the site and were answered.
		const answered: string[] = [];
		const { problems } = await checkTurn(
			() => page( 'Subscribe', OFF_SITE ),
			async () => {
				const opened = await ( await getSharedBrowser() ).newPage();
				opened.on( 'response', ( response ) => {
					const { protocol, origin } = new URL( response.url() );
					if ( protocol.startsWith( 'http' ) && origin !== site.url )
						answered.push( response.url() );
				} );
				return opened;
			}
		);

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ].split( '\n' ).slice( 1 ) ).toEqual( [
			expect.stringMatching(
				/^- \/\?page_id=\d+, the form whose button reads "Subscribe": it sends to subscribe\.wordpress\.com, which takes a submission only from a site connected to WordPress\.com, and this site is not connected \(no Jetpack connection in jetpack_options\), so a visitor's submission goes nowhere; Studio did not send it\.$/
			),
		] );
		expect( answered ).toEqual( [] );
	}, 120000 );

	it( 'reads a changed page with no form without opening a browser', async () => {
		let opened = 0;
		const { problems, took } = await checkTurn(
			() => page( 'About', 'We bake bread.' ),
			() => {
				opened++;
				return Promise.reject( new Error( 'no browser' ) );
			}
		);
		console.warn( `page without a form checked in ${ took }ms` );

		expect( problems ).toEqual( [] );
		expect( opened ).toBe( 0 );
	}, 120000 );

	it.runIf( JETPACK )(
		'costs a turn that changes a page with no form little on a site running Jetpack',
		async () => {
			symlinkSync( JETPACK!, path.join( site.path, 'wp-content/plugins/jetpack' ) );
			await wp( 'plugin', 'activate', 'jetpack' );
			const { problems, took } = await checkTurn( () => page( 'About', 'We bake bread.' ) );
			console.warn( `page without a form, Jetpack active, checked in ${ took }ms` );

			expect( problems ).toEqual( [] );
		},
		120000
	);

	it( 'sends only the forms on what the turn changed', async () => {
		const id = await page( 'Book', NOWHERE );
		// WordPress dates a change to the second.
		await new Promise( ( resolve ) => setTimeout( resolve, 1100 ) );
		const open = new OpenProblems( [] );
		const check = new FormCheck( host, open );
		check.changed( site.path );
		await check.check();
		expect( await open.raise() ).toEqual( [] );

		await wp( 'post', 'update', id, '--user=1', `--post_content=${ STORING }` );
		check.changed( site.path );
		await check.check();
		expect( await open.raise() ).toEqual( [] );
		expect( await query( "SELECT ID FROM wp_posts WHERE post_type = 'enquiry'" ) ).toEqual( [] );
	}, 120000 );

	it.runIf( JETPACK )(
		'sends a Jetpack form as a visitor does and removes its feedback and email',
		async () => {
			symlinkSync( JETPACK!, path.join( site.path, 'wp-content/plugins/jetpack' ) );
			await wp( 'plugin', 'activate', 'jetpack' );
			await wp(
				'eval',
				'Jetpack::activate_default_modules( false, false, array(), false, false, false, false );'
			);
			const { problems, took } = await checkTurn( () => page( 'Contact', JETPACK_FORM ) );
			console.warn( `Jetpack form checked in ${ took }ms` );

			expect( problems ).toEqual( [] );
			expect( await query( "SELECT ID FROM wp_posts WHERE post_type = 'feedback'" ) ).toEqual( [] );
			expect( emails() ).toEqual( [] );
		},
		180000
	);

	it.runIf( JETPACK )(
		'reports a Jetpack form whose submissions it files as spam, and removes the feedback',
		async () => {
			symlinkSync( JETPACK!, path.join( site.path, 'wp-content/plugins/jetpack' ) );
			writeFileSync(
				path.join( site.path, 'wp-content/mu-plugins/spam.php' ),
				"<?php add_filter( 'jetpack_contact_form_is_spam', '__return_true' );"
			);
			await wp( 'plugin', 'activate', 'jetpack' );
			await wp(
				'eval',
				'Jetpack::activate_default_modules( false, false, array(), false, false, false, false );'
			);
			const { problems } = await checkTurn( () => page( 'Contact', JETPACK_FORM ) );

			expect( problems ).toHaveLength( 1 );
			expect( problems[ 0 ] ).toMatch(
				/- \/\?page_id=\d+, the form whose button reads "Contact us" \(Jetpack Forms\): Jetpack saved it only as a feedback post with status spam, as the jetpack_contact_form_is_spam filter judged it spam \(Contact_Form_Plugin::is_spam_blocklist\(\)\), and Jetpack emails no spam \(grunion_still_email_spam\)\. The page then read: ".*"\.$/
			);
			expect( problems[ 0 ] ).not.toMatch( /studio-test-/ );
			expect( await query( "SELECT ID FROM wp_posts WHERE post_type = 'feedback'" ) ).toEqual( [] );
			expect(
				await query( "SELECT meta_id FROM wp_postmeta WHERE meta_key LIKE '_feedback%'" )
			).toEqual( [] );
			expect( emails() ).toEqual( [] );
		},
		180000
	);
} );
