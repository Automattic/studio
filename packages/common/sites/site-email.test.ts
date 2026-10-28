import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSiteEmailDirectory, listSiteEmails, readSiteEmail } from './site-email';

// What PHP's `mail()` pipes to sendmail for a plain `wp_mail()`: no Date header.
const PASSWORD_RESET = [
	'To: admin@example.com',
	'Subject: [My Site] Password Reset',
	'From: WordPress <wordpress@localhost>',
	'Content-Type: text/plain; charset=UTF-8',
	'',
	'Someone has requested a password reset.',
	'http://localhost:8881/wp-login.php?action=rp&key=abc',
	'',
].join( '\n' );

const ORDER_RECEIVED = [
	'Date: Tue, 27 Oct 2026 10:15:00 +0000',
	'To: Jo Shopper <jo@example.com>, shop@example.com',
	'Cc: team@example.com',
	'Subject: =?UTF-8?B?Q29tbWFuZGUgcmXDp3Vl?=',
	'From: "My Shop" <shop@example.com>',
	'Reply-To: help@example.com',
	'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary="outer"',
	'',
	'--outer',
	'Content-Type: multipart/alternative; boundary="inner"',
	'',
	'--inner',
	'Content-Type: text/plain; charset=UTF-8',
	'Content-Transfer-Encoding: quoted-printable',
	'',
	'Merci pour votre commande =E2=80=94 Jo',
	'--inner',
	'Content-Type: text/html; charset=UTF-8',
	'',
	'<p>Merci pour votre <strong>commande</strong></p>',
	'--inner--',
	'--outer',
	'Content-Type: text/plain; name="invoice.txt"',
	'Content-Disposition: attachment; filename="invoice.txt"',
	'',
	'12345',
	'--outer--',
	'',
].join( '\r\n' );

let configDir: string;
const emailDir = () => getSiteEmailDirectory( 'site-1' );

beforeEach( async () => {
	configDir = await mkdtemp( path.join( os.tmpdir(), 'studio-site-email-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	await mkdir( emailDir(), { recursive: true } );
	await writeFile( path.join( emailDir(), '20261027-101500-000001-aaaaaa.eml' ), ORDER_RECEIVED );
	await writeFile( path.join( emailDir(), '20261028-090000-000002-bbbbbb.eml' ), PASSWORD_RESET );
	await utimes(
		path.join( emailDir(), '20261028-090000-000002-bbbbbb.eml' ),
		new Date( '2026-10-28T09:00:00Z' ),
		new Date( '2026-10-28T09:00:00Z' )
	);
} );

afterEach( async () => {
	vi.unstubAllEnvs();
	await rm( configDir, { recursive: true, force: true } );
} );

it( 'lists saved email newest first', async () => {
	await expect( listSiteEmails( 'site-1' ) ).resolves.toEqual( [
		{
			id: '20261028-090000-000002-bbbbbb.eml',
			subject: '[My Site] Password Reset',
			from: { name: 'WordPress', address: 'wordpress@localhost' },
			to: [ { name: '', address: 'admin@example.com' } ],
			date: '2026-10-28T09:00:00.000Z',
		},
		{
			id: '20261027-101500-000001-aaaaaa.eml',
			subject: 'Commande reçue',
			from: { name: 'My Shop', address: 'shop@example.com' },
			to: [
				{ name: 'Jo Shopper', address: 'jo@example.com' },
				{ name: '', address: 'shop@example.com' },
			],
			date: '2026-10-27T10:15:00.000Z',
		},
	] );
} );

it( 'skips messages still being written and files that are not email', async () => {
	await writeFile( path.join( emailDir(), '.20261028-100000-000003-cccccc.eml' ), PASSWORD_RESET );
	await writeFile( path.join( emailDir(), 'notes.txt' ), 'hello' );

	const emails = await listSiteEmails( 'site-1' );

	expect( emails.map( ( email ) => email.id ) ).toEqual( [
		'20261028-090000-000002-bbbbbb.eml',
		'20261027-101500-000001-aaaaaa.eml',
	] );
} );

it( 'lists nothing for a site that has sent no email', async () => {
	await expect( listSiteEmails( 'site-2' ) ).resolves.toEqual( [] );
} );

it( 'reads one email with its bodies and attachments', async () => {
	const email = await readSiteEmail( 'site-1', '20261027-101500-000001-aaaaaa.eml' );

	expect( email ).toMatchObject( {
		subject: 'Commande reçue',
		cc: [ { name: '', address: 'team@example.com' } ],
		replyTo: [ { name: '', address: 'help@example.com' } ],
		html: '<p>Merci pour votre <strong>commande</strong></p>',
		text: 'Merci pour votre commande — Jo',
		attachments: [ { filename: 'invoice.txt', mimeType: 'text/plain', size: 5 } ],
		source: ORDER_RECEIVED,
	} );
} );

it( 'reads a plain text email with no HTML', async () => {
	const email = await readSiteEmail( 'site-1', '20261028-090000-000002-bbbbbb.eml' );

	expect( email?.html ).toBeNull();
	expect( email?.text ).toContain( 'wp-login.php?action=rp&key=abc' );
} );

it( 'reads nothing outside the site email folder', async () => {
	await writeFile( path.join( configDir, 'email', 'secret.eml' ), PASSWORD_RESET );

	await expect( readSiteEmail( 'site-1', '../secret.eml' ) ).resolves.toBeNull();
	await expect( readSiteEmail( 'site-1', 'missing.eml' ) ).resolves.toBeNull();
} );
