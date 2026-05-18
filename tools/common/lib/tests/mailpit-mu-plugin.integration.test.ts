import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import {
	getMailpitBinaryName,
	getMailpitInstallDirName,
	type MailpitConfig,
} from '@studio/common/lib/mailpit';
import { getMuPlugins } from '@studio/common/lib/mu-plugins';
import type { AddressInfo } from 'net';

const execFileAsync = promisify( execFile );

interface MailpitTestServer {
	child: ChildProcess;
	dataDir: string;
	httpPort: number;
	logs: string[];
	smtpPort: number;
}

interface MailpitRecipient {
	Address: string;
	Name: string;
}

interface MailpitMessage {
	Attachments: unknown[] | number;
	Bcc: MailpitRecipient[];
	Cc: MailpitRecipient[];
	HTML: string;
	ID: string;
	ReplyTo: MailpitRecipient[];
	Subject: string;
	Text: string;
	To: MailpitRecipient[];
}

interface MailpitPayloadRecipient {
	Email: string;
	Name?: string;
}

interface MailpitPayloadAttachment {
	Content: string;
	ContentType?: string;
	Filename: string;
}

interface MailpitPayload {
	Attachments?: MailpitPayloadAttachment[];
	Bcc?: string[];
	Cc?: MailpitPayloadRecipient[];
	From: MailpitPayloadRecipient;
	Headers?: Record< string, string >;
	HTML?: string;
	ReplyTo?: MailpitPayloadRecipient[];
	Subject: string;
	Text?: string;
	To: MailpitPayloadRecipient[];
}

interface MailCase {
	atts: {
		attachments?: string[];
		headers?: string[];
		message: string;
		subject: string;
		to: string | string[];
	};
	name: string;
}

interface PhpSendResult {
	body: string | null;
	id: string | null;
	name: string;
	payload: MailpitPayload;
	result: boolean | null;
	status: number;
}

const phpBinary = findPhpBinary();
const mailpitBinaryPath = getBundledMailpitBinaryPath();
const canRunIntegration =
	phpBinary !== null && phpCanOpenLocalSockets( phpBinary ) && existsSync( mailpitBinaryPath );
const describeIfAvailable = canRunIntegration ? describe : describe.skip;

describeIfAvailable( 'Studio MailPit wp_mail integration', () => {
	let server: MailpitTestServer;

	beforeAll( async () => {
		server = await startMailpit();
	}, 30_000 );

	afterAll( async () => {
		await stopMailpit( server );
	} );

	it( 'captures plain-text and HTML messages without forwarding MailPit-managed headers', async () => {
		const prefix = createSubjectPrefix();
		const plainMessage = 'Plain body from Studio MailPit tests.';
		const htmlMessage = '<p>Hello <strong>HTML</strong> from Studio MailPit tests.</p>';
		const [ plain, html ] = await runPhpMailCases( server, [
			{
				name: 'plain',
				atts: {
					to: 'Plain Recipient <plain@example.test>',
					subject: `${ prefix } plain text`,
					message: plainMessage,
					headers: [ 'From: Studio Sender <sender@example.test>', 'X-Studio-Case: plain' ],
				},
			},
			{
				name: 'html',
				atts: {
					to: 'html@example.test',
					subject: `${ prefix } html`,
					message: htmlMessage,
					headers: [
						'Content-Type: text/html; charset=UTF-8',
						'MIME-Version: 1.0',
						'Subject: plugin supplied subject header',
						'X-Studio-Case: html',
					],
				},
			},
		] );

		expectSuccessfulSend( plain );
		expect( plain.payload.Text ).toBe( plainMessage );
		expect( plain.payload.HTML ).toBeUndefined();
		expect( plain.payload.Headers ).toEqual( { 'X-Studio-Case': 'plain' } );

		const capturedPlain = await getMessage( server, plain.id );
		expect( capturedPlain.Text ).toContain( plainMessage );
		expect( capturedPlain.Subject ).toBe( plain.payload.Subject );

		expectSuccessfulSend( html );
		expect( html.payload.HTML ).toBe( htmlMessage );
		expect( html.payload.Text ).toBeUndefined();
		expect( html.payload.Headers ).toEqual( { 'X-Studio-Case': 'html' } );
		expect( html.payload.Headers ).not.toHaveProperty( 'Content-Type' );
		expect( html.payload.Headers ).not.toHaveProperty( 'MIME-Version' );
		expect( html.payload.Headers ).not.toHaveProperty( 'Subject' );

		const capturedHtml = await getMessage( server, html.id );
		expect( capturedHtml.HTML ).toContain( '<strong>HTML</strong>' );
		expect( capturedHtml.Subject ).toBe( html.payload.Subject );
	} );

	it( 'maps recipient headers into MailPit fields', async () => {
		const prefix = createSubjectPrefix();
		const [ result ] = await runPhpMailCases( server, [
			{
				name: 'recipients',
				atts: {
					to: [ 'Primary One <primary-one@example.test>', 'primary-two@example.test' ],
					subject: `${ prefix } recipients`,
					message: 'Recipient mapping body.',
					headers: [
						'From: Sender Name <sender@example.test>',
						'Cc: Copy One <copy-one@example.test>, copy-two@example.test',
						'Bcc: Blind One <blind-one@example.test>, blind-two@example.test',
						'Reply-To: Replies <reply@example.test>',
						'Content-Type: text/plain; charset=UTF-8',
						'X-Studio-Trace: recipient-case',
					],
				},
			},
		] );

		expectSuccessfulSend( result );
		expect( result.payload.From ).toEqual( { Email: 'sender@example.test', Name: 'Sender Name' } );
		expect( result.payload.To ).toEqual( [
			{ Email: 'primary-one@example.test', Name: 'Primary One' },
			{ Email: 'primary-two@example.test' },
		] );
		expect( result.payload.Cc ).toEqual( [
			{ Email: 'copy-one@example.test', Name: 'Copy One' },
			{ Email: 'copy-two@example.test' },
		] );
		expect( result.payload.Bcc ).toEqual( [ 'blind-one@example.test', 'blind-two@example.test' ] );
		expect( result.payload.ReplyTo ).toEqual( [
			{ Email: 'reply@example.test', Name: 'Replies' },
		] );
		expect( result.payload.Headers ).toEqual( { 'X-Studio-Trace': 'recipient-case' } );

		const captured = await getMessage( server, result.id );
		expect( addresses( captured.To ) ).toEqual( [
			'primary-one@example.test',
			'primary-two@example.test',
		] );
		expect( addresses( captured.Cc ) ).toEqual( [
			'copy-one@example.test',
			'copy-two@example.test',
		] );
		expect( addresses( captured.Bcc ) ).toEqual( [
			'blind-one@example.test',
			'blind-two@example.test',
		] );
		expect( addresses( captured.ReplyTo ) ).toEqual( [ 'reply@example.test' ] );
	} );

	it( 'sends readable attachments and skips missing attachments', async () => {
		const prefix = createSubjectPrefix();
		const attachmentDir = await mkdtemp( path.join( tmpdir(), 'studio-mailpit-attachment-' ) );
		const attachmentPath = path.join( attachmentDir, 'mailpit-attachment.txt' );
		const attachmentBody = 'Attachment body from Studio MailPit tests.';

		try {
			await writeFile( attachmentPath, attachmentBody, 'utf8' );

			const [ result ] = await runPhpMailCases( server, [
				{
					name: 'attachments',
					atts: {
						to: 'attachment@example.test',
						subject: `${ prefix } attachment`,
						message: 'Attachment test body.',
						headers: [ 'X-Studio-Case: attachment' ],
						attachments: [ attachmentPath, path.join( attachmentDir, 'missing.txt' ) ],
					},
				},
			] );

			expectSuccessfulSend( result );
			expect( result.payload.Attachments ).toHaveLength( 1 );
			expect( result.payload.Attachments?.[ 0 ] ).toMatchObject( {
				Content: Buffer.from( attachmentBody ).toString( 'base64' ),
				ContentType: 'text/plain',
				Filename: 'mailpit-attachment.txt',
			} );

			const captured = await getMessage( server, result.id );
			expect( captured.Attachments ).toHaveLength( 1 );
		} finally {
			await rm( attachmentDir, { force: true, recursive: true } );
		}
	} );

	it( 'preserves unicode and large message bodies', async () => {
		const prefix = createSubjectPrefix();
		const unicodeText = 'Unicode caf\u{00e9} \u{1f680} body.';
		const largeText = `${ unicodeText } ${ '0123456789'.repeat( 5000 ) }`;
		const subject = `${ prefix } unicode caf\u{00e9} \u{1f680}`;
		const [ result ] = await runPhpMailCases( server, [
			{
				name: 'unicode-large',
				atts: {
					to: 'unicode@example.test',
					subject,
					message: largeText,
					headers: [ 'X-Studio-Case: unicode-large' ],
				},
			},
		] );

		expectSuccessfulSend( result );
		expect( result.payload.Text ).toBe( largeText );

		const captured = await getMessage( server, result.id );
		expect( captured.Subject ).toBe( subject );
		expect( captured.Text ).toContain( unicodeText );
		expect( captured.Text ).toContain( '0123456789'.repeat( 100 ) );
	} );

	it( 'keeps separate site inboxes isolated', async () => {
		const secondServer = await startMailpit();
		const firstSubject = `${ createSubjectPrefix() } first inbox`;
		const secondSubject = `${ createSubjectPrefix() } second inbox`;

		try {
			await runPhpMailCases( server, [
				{
					name: 'first',
					atts: {
						to: 'first@example.test',
						subject: firstSubject,
						message: 'First inbox body.',
					},
				},
			] );
			await runPhpMailCases( secondServer, [
				{
					name: 'second',
					atts: {
						to: 'second@example.test',
						subject: secondSubject,
						message: 'Second inbox body.',
					},
				},
			] );

			const firstSubjects = await listSubjects( server );
			const secondSubjects = await listSubjects( secondServer );

			expect( firstSubjects ).toContain( firstSubject );
			expect( firstSubjects ).not.toContain( secondSubject );
			expect( secondSubjects ).toContain( secondSubject );
			expect( secondSubjects ).not.toContain( firstSubject );
		} finally {
			await stopMailpit( secondServer );
		}
	} );

	it( 'falls back to normal WordPress mail when MailPit is unreachable', async () => {
		const unusedHttpPort = await getFreePort();
		const unusedSmtpPort = await getFreePort();
		const [ result ] = await runPhpMailCases(
			{
				httpPort: unusedHttpPort,
				smtpPort: unusedSmtpPort,
			},
			[
				{
					name: 'unreachable',
					atts: {
						to: 'fallback@example.test',
						subject: `${ createSubjectPrefix() } unreachable`,
						message: 'Fallback body.',
					},
				},
			]
		);

		expect( result.result ).toBeNull();
		expect( result.status ).toBe( 0 );
	} );
} );

function findPhpBinary(): string | null {
	if ( process.env.PHP_BINARY ) {
		const result = spawnSync( process.env.PHP_BINARY, [ '-v' ], { stdio: 'ignore' } );
		if ( result.status === 0 ) {
			return process.env.PHP_BINARY;
		}
	}

	const result = spawnSync( 'php', [ '-v' ], { stdio: 'ignore' } );
	return result.status === 0 ? 'php' : null;
}

function phpCanOpenLocalSockets( binary: string ): boolean {
	const result = spawnSync(
		binary,
		[ '-r', 'echo function_exists("stream_socket_client") ? "1" : "0";' ],
		{
			encoding: 'utf8',
		}
	);
	return result.status === 0 && result.stdout.trim() === '1';
}

function getBundledMailpitBinaryPath(): string {
	return path.join(
		process.cwd(),
		'wp-files',
		'mailpit',
		getMailpitInstallDirName( process.platform, process.arch ),
		getMailpitBinaryName( process.platform )
	);
}

async function startMailpit(): Promise< MailpitTestServer > {
	const httpPort = await getFreePort();
	const smtpPort = await getFreePort();
	const dataDir = await mkdtemp( path.join( tmpdir(), 'studio-mailpit-data-' ) );
	const databasePath = path.join( dataDir, 'mailpit.db' );
	const logs: string[] = [];
	const child = spawn(
		mailpitBinaryPath,
		[
			'--listen',
			`127.0.0.1:${ httpPort }`,
			'--smtp',
			`127.0.0.1:${ smtpPort }`,
			'--database',
			databasePath,
			'--disable-version-check',
		],
		{
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			windowsHide: true,
		}
	);

	child.stdout?.on( 'data', ( chunk ) => logs.push( chunk.toString() ) );
	child.stderr?.on( 'data', ( chunk ) => logs.push( chunk.toString() ) );

	await new Promise< void >( ( resolve, reject ) => {
		child.once( 'spawn', resolve );
		child.once( 'error', reject );
	} );
	await waitForMailpitReady( httpPort, child, logs );

	return {
		child,
		dataDir,
		httpPort,
		logs,
		smtpPort,
	};
}

async function stopMailpit( server?: MailpitTestServer ): Promise< void > {
	if ( ! server ) {
		return;
	}

	if ( server.child && server.child.exitCode === null && ! server.child.killed ) {
		server.child.kill();
		await new Promise< void >( ( resolve ) => {
			const timeout = setTimeout( resolve, 2000 );
			server.child.once( 'exit', () => {
				clearTimeout( timeout );
				resolve();
			} );
		} );
	}

	if ( server.dataDir ) {
		await rm( server.dataDir, { force: true, recursive: true } );
	}
}

async function waitForMailpitReady(
	httpPort: number,
	child: ChildProcess,
	logs: string[]
): Promise< void > {
	const deadline = Date.now() + 5000;
	const url = `http://127.0.0.1:${ httpPort }/api/v1/info`;

	while ( Date.now() < deadline ) {
		if ( child.exitCode !== null ) {
			throw new Error( `MailPit exited early with code ${ child.exitCode }: ${ logs.join( '' ) }` );
		}

		try {
			const response = await fetch( url, { signal: AbortSignal.timeout( 500 ) } );
			if ( response.ok ) {
				return;
			}
		} catch {
			// Keep polling until MailPit starts accepting requests.
		}

		await new Promise< void >( ( resolve ) => setTimeout( resolve, 100 ) );
	}

	throw new Error( `MailPit did not become ready at ${ url }: ${ logs.join( '' ) }` );
}

async function getFreePort(): Promise< number > {
	return await new Promise< number >( ( resolve, reject ) => {
		const server = createServer();
		server.on( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();
			server.close( () => {
				if ( address && typeof address === 'object' ) {
					resolve( ( address as AddressInfo ).port );
					return;
				}
				reject( new Error( 'Unable to allocate a free port for MailPit tests.' ) );
			} );
		} );
	} );
}

async function runPhpMailCases(
	server: Pick< MailpitTestServer, 'httpPort' | 'smtpPort' >,
	cases: MailCase[]
): Promise< PhpSendResult[] > {
	const mailpit: MailpitConfig = {
		enabled: true,
		httpPort: server.httpPort,
		smtpPort: server.smtpPort,
	};
	const [ muPluginsDir ] = await getMuPlugins( {
		mailpit,
		runtime: 'native-php',
	} );
	const harnessDir = await mkdtemp( path.join( tmpdir(), 'studio-mailpit-harness-' ) );
	const scriptPath = path.join( harnessDir, 'run-mailpit-cases.php' );
	const casesPath = path.join( harnessDir, 'cases.json' );

	try {
		await writeFile( casesPath, JSON.stringify( cases ), 'utf8' );
		await writeFile(
			scriptPath,
			createPhpHarness( path.join( muPluginsDir, '0-mailpit.php' ) ),
			'utf8'
		);

		const { stdout, stderr } = await execFileAsync(
			phpBinary as string,
			[ scriptPath, casesPath ],
			{
				maxBuffer: 10 * 1024 * 1024,
				timeout: 30_000,
			}
		);

		if ( stderr.trim() ) {
			throw new Error( stderr );
		}

		return JSON.parse( stdout ) as PhpSendResult[];
	} finally {
		await rm( harnessDir, { force: true, recursive: true } );
		await rm( muPluginsDir, { force: true, recursive: true } );
	}
}

function createPhpHarness( mailpitPluginPath: string ): string {
	return `<?php
$GLOBALS['studio_filters'] = array();
$GLOBALS['studio_remote_posts'] = array();

function add_filter( $tag, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['studio_filters'][ $tag ] = $callback;
}

function sanitize_email( $email ) {
	$email = trim( (string) $email );
	return filter_var( $email, FILTER_VALIDATE_EMAIL ) ? $email : '';
}

function sanitize_text_field( $text ) {
	return trim( preg_replace( '/[\\\\r\\\\n\\\\t]+/', ' ', strip_tags( (string) $text ) ) );
}

function get_option( $name ) {
	return 'admin_email' === $name ? 'admin@example.test' : '';
}

function get_bloginfo( $show = '' ) {
	return 'Studio Test Site';
}

function wp_check_filetype( $path ) {
	$extension = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	$types = array(
		'html' => 'text/html',
		'json' => 'application/json',
		'txt' => 'text/plain',
	);

	return array(
		'ext' => $extension,
		'type' => isset( $types[ $extension ] ) ? $types[ $extension ] : '',
	);
}

function wp_strip_all_tags( $text ) {
	return strip_tags( (string) $text );
}

function wp_json_encode( $data ) {
	return json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

function wp_remote_post( $url, $args ) {
	$body_to_send = isset( $args['body'] ) ? $args['body'] : '';
	$parts = parse_url( $url );
	$host = isset( $parts['host'] ) ? $parts['host'] : '127.0.0.1';
	$port = isset( $parts['port'] ) ? $parts['port'] : 80;
	$path = isset( $parts['path'] ) ? $parts['path'] : '/';
	if ( isset( $parts['query'] ) ) {
		$path .= '?' . $parts['query'];
	}

	$header_lines = array();
	$header_lines[] = 'Host: ' . $host . ':' . $port;
	$header_lines[] = 'Connection: close';
	$header_lines[] = 'Content-Length: ' . strlen( $body_to_send );
	foreach ( isset( $args['headers'] ) ? $args['headers'] : array() as $name => $value ) {
		$header_lines[] = $name . ': ' . $value;
	}

	$timeout = isset( $args['timeout'] ) ? $args['timeout'] : 5;
	$status = 0;
	$body = null;
	$socket = @stream_socket_client( 'tcp://' . $host . ':' . $port, $errno, $errstr, $timeout );

	if ( false !== $socket ) {
		stream_set_timeout( $socket, $timeout );
		fwrite( $socket, 'POST ' . $path . " HTTP/1.1\\r\\n" . implode( "\\r\\n", $header_lines ) . "\\r\\n\\r\\n" . $body_to_send );
		$raw_response = stream_get_contents( $socket );
		fclose( $socket );

		$response_parts = explode( "\\r\\n\\r\\n", $raw_response, 2 );
		$response_headers = isset( $response_parts[0] ) ? $response_parts[0] : '';
		$body = isset( $response_parts[1] ) ? $response_parts[1] : '';

		if ( preg_match( '/^HTTP\\/[^ ]+ ([0-9]{3}) /', $response_headers, $matches ) ) {
			$status = (int) $matches[1];
		}
	}

	$GLOBALS['studio_remote_posts'][] = array(
		'body' => $body,
		'payload' => json_decode( $body_to_send ? $body_to_send : '{}', true ),
		'status' => $status,
	);

	return array(
		'body' => null === $body ? '' : $body,
		'response' => array(
			'code' => $status,
		),
	);
}

function is_wp_error( $response ) {
	return false;
}

function wp_remote_retrieve_response_code( $response ) {
	return isset( $response['response']['code'] ) ? $response['response']['code'] : 0;
}

require ${ JSON.stringify( mailpitPluginPath ) };

$cases = json_decode( file_get_contents( $argv[1] ), true );
$filter = $GLOBALS['studio_filters']['pre_wp_mail'];
$results = array();

foreach ( $cases as $case ) {
	$before_count = count( $GLOBALS['studio_remote_posts'] );
	$result = $filter( null, $case['atts'] );
	$post = isset( $GLOBALS['studio_remote_posts'][ $before_count ] ) ? $GLOBALS['studio_remote_posts'][ $before_count ] : null;
	$response_body = $post ? $post['body'] : null;
	$response_json = $response_body ? json_decode( $response_body, true ) : null;
	$results[] = array(
		'body' => $response_body,
		'id' => isset( $response_json['ID'] ) ? $response_json['ID'] : null,
		'name' => $case['name'],
		'payload' => $post ? $post['payload'] : null,
		'result' => $result,
		'status' => $post ? $post['status'] : null,
	);
}

echo json_encode( $results, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
`;
}

async function getMessage(
	server: Pick< MailpitTestServer, 'httpPort' >,
	id: string | null
): Promise< MailpitMessage > {
	expect( id ).toBeTruthy();
	const response = await fetch( `http://127.0.0.1:${ server.httpPort }/api/v1/message/${ id }` );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch MailPit message ${ id }: ${ await response.text() }` );
	}
	return ( await response.json() ) as MailpitMessage;
}

async function listSubjects( server: Pick< MailpitTestServer, 'httpPort' > ): Promise< string[] > {
	const response = await fetch( `http://127.0.0.1:${ server.httpPort }/api/v1/messages` );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch MailPit messages: ${ await response.text() }` );
	}
	const body = ( await response.json() ) as { messages: Array< { Subject: string } > };
	return body.messages.map( ( message ) => message.Subject );
}

function expectSuccessfulSend( result: PhpSendResult ): void {
	expect( result.result ).toBe( true );
	expect( result.status ).toBeGreaterThanOrEqual( 200 );
	expect( result.status ).toBeLessThan( 300 );
	expect( result.id ).toBeTruthy();
}

function addresses( recipients: MailpitRecipient[] ): string[] {
	return recipients.map( ( recipient ) => recipient.Address );
}

function createSubjectPrefix(): string {
	return `Studio MailPit ${ Date.now() } ${ Math.random().toString( 16 ).slice( 2 ) }`;
}
