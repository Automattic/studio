import fs from 'node:fs';
import path from 'node:path';
import { __, sprintf } from '@wordpress/i18n';
import { callDataLiberationCapture } from 'cli/lib/data-liberation-client';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export interface CaptureResult {
	artifactPath: string;
	outputDir: string;
	provenance: Record< string, unknown >;
}

interface CaptureCommandOptions {
	resume?: boolean;
	captureImages?: boolean;
	onProgress?: ( progress: CaptureProgress ) => void;
	capture?: typeof callDataLiberationCapture;
}

export interface CaptureProgress {
	phase: 'discovering' | 'capturing' | 'finalizing' | 'complete';
	current?: number;
	total?: number;
	url?: string;
}

const logger = new Logger();

export function captureProgressMessage( progress: CaptureProgress ): string {
	if ( progress.phase === 'discovering' ) return __( 'Discovering website routes…' );
	if ( progress.phase === 'finalizing' ) return __( 'Finalizing website artifact…' );
	if ( progress.phase === 'complete' ) return __( 'Website artifact complete' );
	if ( typeof progress.current === 'number' && typeof progress.total === 'number' ) {
		return sprintf(
			/* translators: 1: completed route count, 2: total route count */
			__( 'Capturing route %1$d of %2$d…' ),
			progress.current,
			progress.total
		);
	}
	return __( 'Capturing website routes…' );
}

export async function captureUrl(
	url: string,
	outputDir: string,
	options: CaptureCommandOptions = {}
): Promise< CaptureResult > {
	let parsed: URL;
	try {
		parsed = new URL( url );
	} catch ( error ) {
		throw new LoggerError( sprintf( __( 'Invalid capture URL: %s' ), url ), error );
	}
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new LoggerError( __( 'Capture URLs must use HTTP or HTTPS.' ) );
	}

	fs.mkdirSync( outputDir, { recursive: true } );
	const result = ( await ( options.capture ?? callDataLiberationCapture )( {
		url: parsed.href,
		outputDir,
		resume: options.resume ?? false,
		captureImages: options.captureImages ?? false,
		onProgress: options.onProgress,
	} ) ) as Record< string, unknown >;
	const artifactPath = result.artifactPath;
	if ( typeof artifactPath !== 'string' || ! fs.existsSync( artifactPath ) ) {
		throw new LoggerError( __( 'Capture completed without a replayable website artifact.' ) );
	}
	const captureReceiptPath = result.captureReceiptPath;
	if ( typeof captureReceiptPath === 'string' && fs.existsSync( captureReceiptPath ) ) {
		try {
			const receipt = JSON.parse( fs.readFileSync( captureReceiptPath, 'utf8' ) ) as Record<
				string,
				unknown
			>;
			if (
				receipt.schema !== 'data-liberation/capture-receipt/v1' ||
				typeof receipt.entrypoint !== 'string' ||
				! Array.isArray( receipt.routes )
			) {
				throw new Error( 'Capture receipt has an invalid shape.' );
			}
		} catch ( error ) {
			throw new LoggerError( __( 'Capture produced an invalid website artifact.' ), error );
		}
	} else {
		let artifact: unknown;
		try {
			artifact = JSON.parse( fs.readFileSync( artifactPath, 'utf8' ) );
		} catch ( error ) {
			throw new LoggerError( __( 'Capture produced an invalid website artifact.' ), error );
		}
		if (
			! artifact ||
			typeof artifact !== 'object' ||
			( artifact as Record< string, unknown > ).schema !==
				'blocks-engine/php-transformer/site-artifact/v1' ||
			typeof ( artifact as Record< string, unknown > ).entrypoint !== 'string' ||
			! Array.isArray( ( artifact as Record< string, unknown > ).files )
		) {
			throw new LoggerError( __( 'Capture produced an invalid website artifact.' ) );
		}
	}

	return {
		artifactPath,
		outputDir,
		provenance:
			result.provenance &&
			typeof result.provenance === 'object' &&
			! Array.isArray( result.provenance )
				? ( result.provenance as Record< string, unknown > )
				: {},
	};
}

export async function runCommand(
	url: string,
	outputDir: string,
	options: CaptureCommandOptions = {}
): Promise< CaptureResult > {
	logger.reportStart( 'capture-site', __( 'Capturing website…' ) );
	const result = await captureUrl( url, outputDir, {
		...options,
		onProgress:
			options.onProgress ??
			( ( progress ) => logger.reportProgress( captureProgressMessage( progress ) ) ),
	} );
	logger.reportSuccess( __( 'Website captured successfully' ) );
	logger.reportKeyValuePair( 'artifact', result.artifactPath );
	return result;
}

export const registerCommand = ( yargs: StudioArgv ) =>
	yargs.command( {
		command: 'capture <url>',
		describe: __( 'Capture a website as a replayable static artifact' ),
		builder: ( captureYargs ) =>
			captureYargs
				.positional( 'url', {
					type: 'string',
					demandOption: true,
					description: __( 'Public website URL to capture' ),
				} )
				.option( 'output', {
					type: 'string',
					demandOption: true,
					description: __( 'Directory for the captured artifact and diagnostics' ),
					coerce: ( value ) => path.resolve( untildify( value ) ),
				} )
				.option( 'resume', {
					type: 'boolean',
					default: false,
					description: __( 'Resume an interrupted capture in the output directory' ),
				} )
				.option( 'screenshots', {
					type: 'boolean',
					default: false,
					description: __( 'Retain PNG visual evidence alongside the website artifact' ),
				} ),
		handler: async ( argv ) => {
			try {
				await runCommand( argv.url, argv.output, {
					resume: argv.resume,
					captureImages: argv.screenshots,
				} );
			} catch ( error ) {
				logger.reportError(
					error instanceof LoggerError
						? error
						: new LoggerError( __( 'Failed to capture website' ), error )
				);
			}
		},
	} );
