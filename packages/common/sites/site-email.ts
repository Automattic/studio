/**
 * The email a Studio site sends.
 *
 * PHP's `mail()`, which `wp_mail()` uses, pipes each message to the `sendmail_path`
 * command. Left at PHP's default, that is a sendmail no local machine has set up, so
 * the message is dropped while `mail()` still reports success. The CLI sets
 * `sendmail_path` to its own `php/sendmail.php` instead, which saves each message as
 * an `.eml` file in the site's email folder, named by the time it arrived.
 */
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import PostalMime, { type Address } from 'postal-mime';
import { getConfigDirectory } from '../lib/well-known-paths';

export interface SiteEmailAddress {
	name: string;
	address: string;
}

export interface SiteEmailSummary {
	// The file name, which sorts by arrival.
	id: string;
	subject: string;
	from: SiteEmailAddress | null;
	to: SiteEmailAddress[];
	// ISO 8601: the Date header, or when the file was saved if it has none.
	date: string;
}

export interface SiteEmailAttachment {
	filename: string | null;
	mimeType: string;
	size: number;
}

export interface SiteEmail extends SiteEmailSummary {
	cc: SiteEmailAddress[];
	replyTo: SiteEmailAddress[];
	html: string | null;
	text: string | null;
	attachments: SiteEmailAttachment[];
	// The message as the site sent it.
	source: string;
}

// sendmail.php writes under a dot-prefixed name and renames once complete, so a
// leading dot is a message still being written.
const EMAIL_FILE = /^[\w-][\w.-]*\.eml$/;

// Under Studio's own directory rather than the site's, so a site's email is never
// committed, pushed or synced with its files.
export function getSiteEmailDirectory( siteId: string ): string {
	return path.join( getConfigDirectory(), 'email', siteId );
}

/** The site's email folder, made first if the site hasn't sent any email, so it can be opened. */
export async function ensureSiteEmailDirectory( siteId: string ): Promise< string > {
	const directory = getSiteEmailDirectory( siteId );
	await mkdir( directory, { recursive: true, mode: 0o700 } );
	return directory;
}

function toAddresses( addresses: Address[] | Address | undefined ): SiteEmailAddress[] {
	return ( Array.isArray( addresses ) ? addresses : addresses ? [ addresses ] : [] ).flatMap(
		( address ) =>
			address.group
				? address.group.map( ( { name, address: email } ) => ( { name, address: email } ) )
				: [ { name: address.name, address: address.address } ]
	);
}

async function getSavedDate( filePath: string, header: string | undefined ): Promise< string > {
	if ( header && ! Number.isNaN( Date.parse( header ) ) ) {
		return new Date( header ).toISOString();
	}
	return ( await stat( filePath ) ).mtime.toISOString();
}

async function readSummary( directory: string, id: string ): Promise< SiteEmailSummary | null > {
	const filePath = path.join( directory, id );
	try {
		const source = await readFile( filePath );
		// The list needs only the headers, which end at the first empty line.
		const headerEnd = [ source.indexOf( '\r\n\r\n' ), source.indexOf( '\n\n' ) ]
			.filter( ( index ) => index !== -1 )
			.reduce( ( first, index ) => Math.min( first, index ), source.length );
		const email = await PostalMime.parse(
			Buffer.concat( [ source.subarray( 0, headerEnd ), Buffer.from( '\r\n\r\n' ) ] )
		);
		return {
			id,
			subject: email.subject ?? '',
			from: toAddresses( email.from )[ 0 ] ?? null,
			to: toAddresses( email.to ),
			date: await getSavedDate( filePath, email.date ),
		};
	} catch {
		return null;
	}
}

/** The site's saved email, newest first, with only what a list needs. */
export async function listSiteEmails( siteId: string ): Promise< SiteEmailSummary[] > {
	const directory = getSiteEmailDirectory( siteId );
	const ids = await readdir( directory ).catch( () => [] as string[] );
	const summaries = await Promise.all(
		ids
			.filter( ( id ) => EMAIL_FILE.test( id ) )
			.sort()
			.reverse()
			.map( ( id ) => readSummary( directory, id ) )
	);
	return summaries.filter( ( summary ): summary is SiteEmailSummary => summary !== null );
}

/** One saved email, parsed, or null when there is no such email. */
export async function readSiteEmail(
	siteId: string,
	emailId: string
): Promise< SiteEmail | null > {
	if ( ! EMAIL_FILE.test( emailId ) ) {
		return null;
	}
	const filePath = path.join( getSiteEmailDirectory( siteId ), emailId );
	let source: Buffer;
	try {
		source = await readFile( filePath );
	} catch {
		return null;
	}
	const email = await PostalMime.parse( source, { attachmentEncoding: 'arraybuffer' } );
	return {
		id: emailId,
		subject: email.subject ?? '',
		from: toAddresses( email.from )[ 0 ] ?? null,
		to: toAddresses( email.to ),
		cc: toAddresses( email.cc ),
		replyTo: toAddresses( email.replyTo ),
		date: await getSavedDate( filePath, email.date ),
		html: email.html ?? null,
		text: email.text ?? null,
		attachments: email.attachments.map( ( attachment ) => ( {
			filename: attachment.filename,
			mimeType: attachment.mimeType,
			size:
				typeof attachment.content === 'string'
					? attachment.content.length
					: attachment.content.byteLength,
		} ) ),
		source: source.toString( 'utf8' ),
	};
}
