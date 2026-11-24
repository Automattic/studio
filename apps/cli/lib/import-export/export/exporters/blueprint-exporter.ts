import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ARCHIVER_OPTIONS } from '@studio/common/constants';
import { extractZip } from '@studio/common/lib/extract-zip';
import { createExportErrorPayload, ExportEvents } from '@studio/common/lib/import-export-events';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import { __, sprintf } from '@wordpress/i18n';
import { ZipArchive } from 'archiver';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import sourceScript from '../blueprint-source.php?raw';
import setupScript from '../blueprint-setup.php?raw';
import { ImportExportEventEmitter } from '../../events';
import type { Exporter, ExportOptions } from '../types';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

type SourceMedia = {
	id: number;
	file: string;
	urls: Record< string, string >;
	title: string;
	caption: string;
	description: string;
	alt: string;
	mime: string;
};

type Source = {
	siteUrl: string;
	uploadsUrl: string;
	uploadsPath: string;
	theme: string;
	themePath: string;
	parentTheme: string | null;
	parentThemePath: string | null;
	wordpressVersion: string;
	plugins: { file: string; slug: string; name: string }[];
	media: SourceMedia[];
	posts: unknown[];
	options: Record< string, unknown >;
	linkedOptions: Record< string, number >;
	wooAttributes: unknown[];
	frontPage: number;
	postsPage: number;
	siteIcon: number;
	customLogo: number;
	customCss: string;
};

function portableText( text: string, source: Pick< Source, 'siteUrl' | 'uploadsUrl' > ): string {
	return text
		.split( source.uploadsUrl )
		.join( '{{STUDIO_BLUEPRINT_UPLOADS}}' )
		.split( source.siteUrl )
		.join( '{{STUDIO_BLUEPRINT_SITE}}' );
}

async function archiveFiles(
	destination: string,
	write: ( archive: ZipArchive ) => Promise< void > | void
): Promise< void > {
	const archive = new ZipArchive( ARCHIVER_OPTIONS.zip );
	archive.on( 'warning', ( error ) => archive.destroy( error ) );
	const output = pipeline( archive, fs.createWriteStream( destination ) );
	try {
		await write( archive );
		await Promise.all( [ output, archive.finalize() ] );
	} catch ( error ) {
		archive.destroy( error instanceof Error ? error : new Error( String( error ) ) );
		await output.catch( () => undefined );
		throw error;
	}
}

async function prepareTheme( stage: string, source: Source, output: string ): Promise< string > {
	if ( ! /^[a-zA-Z0-9_-]+$/.test( source.theme ) ) {
		throw new Error( __( 'The active theme has an invalid folder name.' ) );
	}
	const themeDirectory = path.join( stage, 'theme' );
	await fs.promises.mkdir( themeDirectory );
	await extractZip( path.join( stage, 'theme.zip' ), themeDirectory );
	const sourceTheme = await fs.promises.realpath( source.themePath );
	const outputInTheme = path.relative( sourceTheme, output );
	if (
		outputInTheme &&
		! outputInTheme.startsWith( '..' + path.sep ) &&
		! path.isAbsolute( outputInTheme )
	) {
		await fs.promises.rm( path.join( themeDirectory, outputInTheme ), { force: true } );
	}
	async function prepareDirectory( directory: string ): Promise< void > {
		for ( const entry of await fs.promises.readdir( directory, { withFileTypes: true } ) ) {
			const file = path.join( directory, entry.name );
			if (
				entry.name.startsWith( '.' ) ||
				/\.(?:sql|sqlite|sqlite3|db|log)$/i.test( entry.name )
			) {
				await fs.promises.rm( file, { recursive: true, force: true } );
			} else if ( entry.isDirectory() ) {
				await prepareDirectory( file );
			} else if ( entry.isFile() && /\.(?:html|json|css|php)$/i.test( entry.name ) ) {
				const content = await fs.promises.readFile( file, 'utf8' );
				await fs.promises.writeFile( file, portableText( content, source ) );
			}
		}
	}
	await prepareDirectory( themeDirectory );
	const result = path.join( stage, 'blueprint-theme.zip' );
	await archiveFiles( result, ( archive ) => {
		archive.directory( themeDirectory, source.theme );
	} );
	return result;
}

async function prepareParentTheme(
	stage: string,
	source: Source,
	output: string
): Promise< string | undefined > {
	if ( ! source.parentTheme || ! source.parentThemePath ) return undefined;
	if ( ! /^[a-zA-Z0-9_-]+$/.test( source.parentTheme ) ) {
		throw new Error( __( 'The parent theme has an invalid folder name.' ) );
	}
	const directory = path.join( stage, 'parent-theme' );
	async function copyDirectory( from: string, to: string ): Promise< void > {
		await fs.promises.mkdir( to, { recursive: true } );
		for ( const entry of await fs.promises.readdir( from, { withFileTypes: true } ) ) {
			if (
				entry.name.startsWith( '.' ) ||
				/\.(?:sql|sqlite|sqlite3|db|log)$/i.test( entry.name ) ||
				entry.name === 'node_modules'
			)
				continue;
			const original = path.join( from, entry.name );
			const destination = path.join( to, entry.name );
			if ( entry.isSymbolicLink() ) {
				throw new Error(
					__( 'The parent theme contains a symbolic link and cannot be exported safely.' )
				);
			}
			if ( entry.isDirectory() ) {
				await copyDirectory( original, destination );
			} else if ( entry.isFile() && ( await fs.promises.realpath( original ) ) !== output ) {
				if ( /\.(?:html|json|css|php)$/i.test( entry.name ) ) {
					await fs.promises.writeFile(
						destination,
						portableText( await fs.promises.readFile( original, 'utf8' ), source )
					);
				} else {
					await fs.promises.copyFile( original, destination );
				}
			}
		}
	}
	await copyDirectory( source.parentThemePath, directory );
	const result = path.join( stage, 'blueprint-parent-theme.zip' );
	await archiveFiles( result, ( archive ) => {
		archive.directory( directory, source.parentTheme! );
	} );
	return result;
}

async function validatePlugins( plugins: Source[ 'plugins' ] ): Promise< void > {
	await Promise.all(
		plugins.map( async ( plugin ) => {
			const params = new URLSearchParams( {
				action: 'plugin_information',
				'request[slug]': plugin.slug,
				'request[fields][sections]': 'false',
			} );
			try {
				const response = await fetch( `https://api.wordpress.org/plugins/info/1.2/?${ params }`, {
					signal: AbortSignal.timeout( 15_000 ),
				} );
				const result = ( await response.json() ) as { slug?: string };
				if ( response.ok && result.slug === plugin.slug ) return;
			} catch {
				throw new Error(
					__(
						'Could not check the active plugins on WordPress.org. Check your connection and try again.'
					)
				);
			}
			throw new Error(
				sprintf(
					/* translators: %s: plugin name. */
					__(
						'The active plugin %s is not available from WordPress.org. Deactivate it before exporting this Blueprint.'
					),
					plugin.name
				)
			);
		} )
	);
}

export class BlueprintExporter extends ImportExportEventEmitter implements Exporter {
	constructor( private readonly options: ExportOptions ) {
		super();
	}

	async canHandle(): Promise< boolean > {
		return this.options.backupFile.toLowerCase().endsWith( '.zip' );
	}

	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		const stage = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-blueprint-' ) );
		let temporaryOutput: string | undefined;
		try {
			if ( ! ( await this.canHandle() ) ) {
				throw new Error( __( 'A Blueprint export must be a .zip file.' ) );
			}
			const outputDir = await fs.promises.realpath( path.dirname( this.options.backupFile ) );
			const existing = await fs.promises
				.lstat( this.options.backupFile )
				.catch( ( error: NodeJS.ErrnoException ) => {
					if ( error.code === 'ENOENT' ) return undefined;
					throw error;
				} );
			const output = existing
				? await fs.promises.realpath( this.options.backupFile )
				: path.join( outputDir, path.basename( this.options.backupFile ) );
			this.emit( ExportEvents.WP_CONTENT_EXPORT_START );
			const scriptPath = path.join( stage, 'blueprint-source.php' );
			await fs.promises.writeFile( scriptPath, sourceScript );
			await using command = await runWpCliCommand( this.options.site, [ 'eval-file', scriptPath ], {
				phpVersion: resolveSupportedPhpVersion( this.options.phpVersion ),
			} );
			const [ code, stderr ] = await Promise.all( [
				command.response.exitCode,
				command.response.stderrText,
			] );
			if ( code !== 0 )
				throw new Error( stderr || __( 'Could not read the site for Blueprint export.' ) );
			const source = JSON.parse(
				await fs.promises.readFile( path.join( stage, 'source.json' ), 'utf8' )
			) as Source;
			await validatePlugins( source.plugins );
			const theme = await prepareTheme( stage, source, output );
			const parentTheme = await prepareParentTheme( stage, source, output );
			const uploadsRoot = source.media.length
				? await fs.promises.realpath( source.uploadsPath )
				: '';
			const media = await Promise.all(
				source.media.map( async ( item ) => {
					const file = await fs.promises.realpath( item.file );
					const relative = path.relative( uploadsRoot, file );
					if ( relative.startsWith( '..' + path.sep ) || path.isAbsolute( relative ) ) {
						throw new Error( __( 'A referenced media file is outside the site uploads folder.' ) );
					}
					if ( ! path.relative( file, output ) ) {
						throw new Error(
							__( 'Choose a destination that is not one of the site’s media files.' )
						);
					}
					return {
						...item,
						file,
						name: path.basename( file ),
						bundle: `media/${ item.id }-${ path.basename( file ) }`,
					};
				} )
			);
			const steps: NonNullable< BlueprintV1Declaration[ 'steps' ] > = [ { step: 'resetData' } ];
			if ( parentTheme ) {
				steps.push( {
					step: 'installTheme',
					themeData: { resource: 'bundled', path: '/parent-theme.zip' },
					options: { activate: false },
				} );
			}
			steps.push( {
				step: 'installTheme',
				themeData: { resource: 'bundled', path: '/theme.zip' },
				options: { activate: true },
			} );
			for ( const plugin of source.plugins ) {
				steps.push( {
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: plugin.slug },
					options: { activate: true },
				} );
			}
			steps.push( { step: 'mkdir', path: '/wordpress/wp-content/studio-blueprint-resources' } );
			steps.push( {
				step: 'mkdir',
				path: '/wordpress/wp-content/studio-blueprint-resources/media',
			} );
			steps.push( {
				step: 'writeFile',
				path: '/wordpress/wp-content/studio-blueprint-resources/content.json',
				data: { resource: 'bundled', path: '/content.json' },
			} );
			for ( const item of media ) {
				steps.push( {
					step: 'writeFile',
					path: `/wordpress/wp-content/studio-blueprint-resources/${ item.bundle }`,
					data: { resource: 'bundled', path: `/${ item.bundle }` },
				} );
			}
			steps.push( { step: 'runPHP', code: setupScript } );
			const blueprint: BlueprintV1Declaration & { $schema: string } = {
				$schema: 'https://playground.wordpress.net/blueprint-schema.json',
				meta: { title: this.options.site.name, author: 'Site owner' },
				preferredVersions: {
					php: resolveSupportedPhpVersion( this.options.phpVersion ) as NonNullable<
						BlueprintV1Declaration[ 'preferredVersions' ]
					>[ 'php' ],
					wp: source.wordpressVersion || 'latest',
				},
				landingPage: '/',
				steps,
			};
			const content = {
				posts: source.posts,
				media: media.map( ( { file: _file, ...item } ) => item ),
				options: source.options,
				linkedOptions: source.linkedOptions,
				wooAttributes: source.wooAttributes,
				frontPage: source.frontPage,
				postsPage: source.postsPage,
				siteIcon: source.siteIcon,
				customLogo: source.customLogo,
				customCss: source.customCss,
			};
			temporaryOutput = path.join(
				path.dirname( output ),
				`.${ path.basename( output ) }.${ randomUUID() }.tmp`
			);
			await archiveFiles( temporaryOutput, ( archive ) => {
				archive.append( JSON.stringify( blueprint, null, 2 ), { name: 'blueprint.json' } );
				archive.append( portableText( JSON.stringify( content, null, 2 ), source ), {
					name: 'content.json',
				} );
				archive.file( theme, { name: 'theme.zip' } );
				if ( parentTheme ) archive.file( parentTheme, { name: 'parent-theme.zip' } );
				for ( const item of media ) archive.file( item.file, { name: item.bundle } );
			} );
			await fs.promises.rename( temporaryOutput, output );
			this.emit( ExportEvents.WP_CONTENT_EXPORT_COMPLETE );
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.emit( ExportEvents.EXPORT_ERROR, createExportErrorPayload( error ) );
			throw error;
		} finally {
			if ( temporaryOutput ) await fs.promises.rm( temporaryOutput, { force: true } );
			await fs.promises.rm( stage, { recursive: true, force: true } );
		}
	}
}
