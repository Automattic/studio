import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PushPhase } from '@studio/common/types/sync';

export type Visibility = {
	id: number;
	url: string;
	private: boolean;
	comingSoon: boolean;
	blogPublic: number;
	launchStatus: string | null;
};
export type Target = { id: number; url: string };
export type Manifest = {
	pages: Array< { slug: string; hash: string; title: string; probe?: string; url?: string } >;
	media: Array< { file: string } >;
};
export type Verification = { pages: number; media: number; visibility: string; screenshot: string };
export type LocalAccessOptions = {
	wpcom_coming_soon: number | null;
	wpcom_public_coming_soon: number | null;
};
export type PublishOptions = {
	sitePath: string;
	remoteSite: string;
	visibility: 'preserve' | 'private';
	directory: string;
	mode: 'plan' | 'publish' | 'verify';
	operationId?: string;
};
export type PublishEvent = {
	type: string;
	phase: string;
	progress?: number;
	remoteUrl?: string;
	result?: Publication;
};
export type Publication = {
	v: 1;
	sitePath: string;
	visibility: 'preserve' | 'private';
	operationId: string;
	phase: string;
	remote: Target;
	before: Visibility;
	expected: Visibility;
	startedAt: string;
	updatedAt: string;
	finishedAt?: string;
	manifest?: Manifest;
	originalLocalVisibility?: string;
	originalLocalAccessOptions?: LocalAccessOptions;
	exportStaged?: boolean;
	transferStarted?: boolean;
	transferCompleted?: boolean;
	cleanupComplete?: boolean;
	verification?: Verification;
	error?: string;
	timings: Record< string, number >;
};
export type PublishServices = {
	resolve: ( identifier: string ) => Promise< Target >;
	snapshot: ( target: Target ) => Promise< Visibility >;
	verifyAccess: (
		target: Target,
		manifest: Manifest,
		expected: Visibility,
		directory: string
	) => Promise< string >;
	makePrivate: ( target: Target ) => Promise< void >;
	manifest: () => Promise< Manifest >;
	localVisibility: () => Promise< string >;
	setLocalVisibility: ( value: string ) => Promise< void >;
	localAccessOptions: () => Promise< LocalAccessOptions >;
	setLocalAccessOptions: ( value: LocalAccessOptions ) => Promise< void >;
	withLocalExportLock: ( action: () => Promise< void > ) => Promise< void >;
	push: (
		target: Target,
		hooks: {
			beforeExport: () => Promise< void >;
			afterExport: () => Promise< void >;
			excludePatterns: string[];
			onPhase: ( phase: PushPhase, progress?: number ) => void;
		}
	) => Promise< void >;
	verify: (
		target: Target,
		manifest: Manifest,
		expected: Visibility,
		directory: string
	) => Promise< Verification >;
};
const iso = () => new Date().toISOString();
function save( file: string, value: Publication ) {
	const temp = file + '.' + randomUUID() + '.tmp';
	fs.writeFileSync( temp, JSON.stringify( value, null, 2 ) + '\n', { flag: 'wx', mode: 0o600 } );
	fs.renameSync( temp, file );
}
export function sameVisibility( a: Visibility, b: Visibility ) {
	return (
		a.id === b.id &&
		a.url.replace( /\/$/, '' ) === b.url.replace( /\/$/, '' ) &&
		a.private === b.private &&
		a.comingSoon === b.comingSoon &&
		a.blogPublic === b.blogPublic &&
		a.launchStatus === b.launchStatus
	);
}
export function validatePublicationTarget( identifier: string ) {
	if (
		typeof identifier !== 'string' ||
		identifier !== identifier.trim() ||
		! /^(?:[0-9]+|https:\/\/[a-z0-9.-]+\/?)$/.test( identifier )
	)
		throw new Error( 'Provide an exact site ID or HTTPS destination.' );
}
export async function publishOperation(
	options: PublishOptions,
	services: PublishServices,
	emit: ( event: PublishEvent ) => void = () => {},
	signal?: AbortSignal
) {
	validatePublicationTarget( options.remoteSite );
	if ( ! path.isAbsolute( options.sitePath ) )
		throw new Error( 'Source site path must be absolute.' );
	if ( ! path.isAbsolute( options.directory ) )
		throw new Error( 'Publication directory must be absolute.' );
	fs.mkdirSync( options.directory, { recursive: true, mode: 0o700 } );
	const file = path.join( options.directory, 'receipt.json' );
	let receipt: Publication | undefined;
	const lock = path.join( options.directory, 'owner.lock' );
	if ( fs.existsSync( lock ) && options.mode === 'verify' ) {
		const pid = Number( fs.readFileSync( lock, 'utf8' ) );
		if ( ! Number.isSafeInteger( pid ) || pid <= 0 )
			throw new Error( 'Publication lock ownership is unknown.' );
		try {
			process.kill( pid, 0 );
			throw new Error( 'Publication is still running.' );
		} catch ( error ) {
			if ( ( error as NodeJS.ErrnoException ).code !== 'ESRCH' ) throw error;
		}
		fs.unlinkSync( lock );
	}
	const descriptor = fs.openSync( lock, 'wx', 0o600 );
	fs.writeFileSync( descriptor, String( process.pid ) );
	fs.closeSync( descriptor );
	const started = performance.now();
	let lastEvent = '',
		writableReceipt = false;
	const write = ( phase: string, progress?: number ) => {
		if ( ! receipt ) throw new Error( 'Publication is not initialized.' );
		receipt.phase = phase;
		receipt.updatedAt = iso();
		save( file, receipt );
		const key = JSON.stringify( [ phase, progress ] );
		if ( key !== lastEvent ) {
			emit( { type: 'publication.progress', phase, progress, remoteUrl: receipt.remote.url } );
			lastEvent = key;
		}
	};
	const cancelled = () => {
		if ( signal?.aborted && ! receipt?.transferStarted )
			throw new Error( 'Publication cancelled before transfer.' );
	};
	const cleanupUnlocked = async () => {
		if ( ! receipt?.exportStaged || receipt.originalLocalVisibility === undefined ) return;
		if ( receipt.originalLocalAccessOptions ) {
			const currentOptions = await services.localAccessOptions();
			const staged = {
				wpcom_coming_soon: 0,
				wpcom_public_coming_soon: receipt.expected.comingSoon ? 1 : 0,
			};
			for ( const key of Object.keys( staged ) as Array< keyof LocalAccessOptions > ) {
				if (
					currentOptions[ key ] !== staged[ key ] &&
					currentOptions[ key ] !== receipt.originalLocalAccessOptions[ key ]
				)
					throw new Error(
						'Local Coming Soon settings changed concurrently; cleanup requires review.'
					);
			}
			await services.setLocalAccessOptions( receipt.originalLocalAccessOptions );
			if (
				JSON.stringify( await services.localAccessOptions() ) !==
				JSON.stringify( receipt.originalLocalAccessOptions )
			)
				throw new Error( 'Local Coming Soon restoration was not confirmed.' );
		}
		const current = await services.localVisibility();
		if ( current === String( receipt.expected.blogPublic ) )
			await services.setLocalVisibility( receipt.originalLocalVisibility );
		else if ( current !== receipt.originalLocalVisibility )
			throw new Error( 'Local visibility changed concurrently; cleanup requires review.' );
		if ( ( await services.localVisibility() ) !== receipt.originalLocalVisibility )
			throw new Error( 'Local visibility restoration was not confirmed.' );
		receipt.exportStaged = false;
		receipt.cleanupComplete = true;
		save( file, receipt );
	};
	const cleanup = () =>
		receipt?.exportStaged ? services.withLocalExportLock( cleanupUnlocked ) : Promise.resolve();
	try {
		if ( fs.existsSync( file ) )
			receipt = JSON.parse( fs.readFileSync( file, 'utf8' ) ) as Publication;
		if (
			receipt &&
			( receipt.sitePath !== options.sitePath ||
				( options.operationId && receipt.operationId !== options.operationId ) ||
				receipt.visibility !== options.visibility )
		)
			throw new Error(
				'The publication receipt belongs to another source, operation, or visibility request.'
			);
		if ( options.mode !== 'verify' && receipt?.transferStarted )
			throw new Error( 'A transfer was already attempted. Verify its result; do not replay it.' );
		if ( options.mode !== 'verify' && receipt?.exportStaged )
			throw new Error( 'An interrupted export requires verify-only cleanup before replanning.' );
		cancelled();
		const remote = await services.resolve( options.remoteSite );
		const before = await services.snapshot( remote );
		if (
			before.id !== remote.id ||
			new URL( before.url ).hostname !== new URL( remote.url ).hostname
		)
			throw new Error( 'Remote identity mismatch.' );
		if (
			receipt &&
			( receipt.remote.id !== remote.id ||
				new URL( receipt.remote.url ).hostname !== new URL( remote.url ).hostname )
		)
			throw new Error( 'The publication receipt belongs to another destination.' );
		writableReceipt = true;
		if ( ! receipt || options.mode === 'plan' ) {
			receipt = {
				v: 1,
				sitePath: options.sitePath,
				visibility: options.visibility,
				operationId: options.operationId ?? randomUUID(),
				phase: 'preflight',
				remote,
				before,
				expected:
					options.visibility === 'private'
						? { ...before, private: true, comingSoon: false, blogPublic: -1 }
						: before,
				startedAt: iso(),
				updatedAt: iso(),
				timings: {},
			};
			save( file, receipt );
		}
		if ( options.mode === 'plan' ) {
			cancelled();
			if ( before.private || before.comingSoon )
				await services.verifyAccess( remote, { pages: [], media: [] }, before, options.directory );
			cancelled();
			write( 'planned' );
			emit( { type: 'publication.completed', phase: 'planned', result: receipt } );
			return receipt;
		}
		if ( options.mode === 'publish' && ! sameVisibility( receipt.before, before ) )
			throw new Error(
				'Destination visibility changed since preflight. Replan before transferring.'
			);
		if ( options.mode === 'publish' && options.visibility === 'private' && ! before.private ) {
			cancelled();
			write( 'securing-destination' );
			await services.makePrivate( remote );
			const secured = await services.snapshot( remote );
			if ( ! secured.private || secured.blogPublic !== -1 )
				throw new Error( 'Private access was not confirmed before transfer.' );
			receipt.expected = secured;
			save( file, receipt );
		}
		receipt.manifest ??= await services.manifest();
		if ( options.mode === 'publish' ) {
			cancelled();
			if ( receipt.expected.private || receipt.expected.comingSoon ) {
				write( 'checking-access' );
				await services.verifyAccess(
					remote,
					receipt.manifest,
					receipt.expected,
					options.directory
				);
				cancelled();
			}
			write( 'preparing-export' );
			const transferStart = performance.now();
			await services.push( remote, {
				excludePatterns: [ '/wp-content/mu-plugins/0-preview-offline.php' ],
				beforeExport: async () => {
					cancelled();
					receipt!.originalLocalVisibility = await services.localVisibility();
					receipt!.originalLocalAccessOptions = await services.localAccessOptions();
					receipt!.exportStaged = true;
					save( file, receipt! );
					await services.setLocalVisibility( String( receipt!.expected.blogPublic ) );
					await services.setLocalAccessOptions( {
						wpcom_coming_soon: 0,
						wpcom_public_coming_soon: receipt!.expected.comingSoon ? 1 : 0,
					} );
					const staged = await services.localAccessOptions();
					if (
						( await services.localVisibility() ) !== String( receipt!.expected.blogPublic ) ||
						staged.wpcom_coming_soon !== 0 ||
						staged.wpcom_public_coming_soon !== ( receipt!.expected.comingSoon ? 1 : 0 )
					)
						throw new Error( 'Coming Soon export settings were not confirmed; transfer blocked.' );
				},
				afterExport: cleanupUnlocked,
				onPhase: ( phase, progress ) => {
					cancelled();
					if ( phase === 'uploading' ) receipt!.transferStarted = true;
					write( phase, progress );
				},
			} );
			receipt.transferCompleted = true;
			receipt.timings.transfer = performance.now() - transferStart;
			save( file, receipt );
		}
		await cleanup();
		cancelled();
		write( 'verifying' );
		const verificationStart = performance.now();
		receipt.verification = await services.verify(
			remote,
			receipt.manifest,
			receipt.expected,
			options.directory
		);
		const after = await services.snapshot( remote );
		if ( ! sameVisibility( receipt.expected, after ) )
			throw new Error( 'Destination visibility was not preserved.' );
		receipt.timings.verification = performance.now() - verificationStart;
		receipt.timings.total = performance.now() - started;
		receipt.finishedAt = iso();
		delete receipt.error;
		receipt.cleanupComplete = true;
		write( options.mode === 'verify' ? 'verified' : 'published' );
		emit( { type: 'publication.completed', phase: receipt.phase, result: receipt } );
		return receipt;
	} catch ( error ) {
		if ( receipt && writableReceipt ) {
			try {
				await cleanup();
			} catch ( cleanupError ) {
				receipt.error = 'Cleanup failed: ' + ( cleanupError as Error ).message;
				receipt.cleanupComplete = false;
			}
			receipt.error = [ receipt.error, ( error as Error ).message ].filter( Boolean ).join( '; ' );
			write( receipt.transferStarted ? 'needs-verification' : 'failed' );
			emit( { type: 'publication.failed', phase: receipt.phase, result: receipt } );
		}
		throw error;
	} finally {
		fs.unlinkSync( lock );
	}
}
