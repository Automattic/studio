import fs from 'fs';
import path from 'path';
import {
	acceptDesignArtifact,
	getDesignProjectRoot,
	readDesignProject,
	registerDesignArtifact,
	resolveDesignProjectPath,
	updateDesignProject,
} from '@studio/common/design-project';
import { Type } from 'typebox';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getBundledStaticSiteImporterPath } from 'cli/lib/dependency-management/paths';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

const RESOURCE_POLICY =
	"default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' data: blob:; script-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

function injectResourcePolicy( html: string ): string {
	const withoutScripts = html.replace( /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '' );
	const meta = `<meta http-equiv="Content-Security-Policy" content="${ RESOURCE_POLICY }">`;
	if ( /<head\b[^>]*>/i.test( withoutScripts ) ) {
		return withoutScripts.replace( /<head\b[^>]*>/i, ( match ) => `${ match }\n${ meta }` );
	}
	return `${ meta }\n${ withoutScripts }`;
}

async function runWpCli( site: Awaited< ReturnType< typeof resolveSite > >, args: string[] ) {
	await using command = await runWpCliCommandWithMessaging( site, args );
	const [ exitCode, stdout, stderr ] = await Promise.all( [
		command.response.exitCode,
		command.response.stdoutText,
		command.response.stderrText,
	] );
	if ( exitCode !== 0 ) {
		throw new Error( ( stderr || stdout || `WP-CLI exited with code ${ exitCode }` ).trim() );
	}
	return stdout.trim();
}

export const designProjectStatusTool = defineTool(
	'design_project_status',
	'Reads the persistent AI design project for a Studio site, including its brief, phase, design directions, selection, and materialization state.',
	{ nameOrPath: Type.String( { description: 'Studio site name or path' } ) },
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const project = await readDesignProject( site.path );
		return textResult( project ? JSON.stringify( project, null, 2 ) : 'No design project exists.' );
	}
);

export const designProjectWaitTool = defineTool(
	'design_project_wait',
	'Waits efficiently for parallel design workers to register a requested number of artifacts in the shared project manifest. Use this instead of repeated status calls or shell sleep loops.',
	{
		nameOrPath: Type.String( { description: 'Studio site name or path' } ),
		minimumArtifacts: Type.Optional(
			Type.Integer( { minimum: 1, maximum: 12, description: 'Artifact count to wait for' } )
		),
		timeoutSeconds: Type.Optional(
			Type.Integer( { minimum: 1, maximum: 600, description: 'Maximum wait in seconds' } )
		),
	},
	async ( args, signal ) => {
		const site = await resolveSite( args.nameOrPath );
		const minimumArtifacts = args.minimumArtifacts ?? 3;
		const deadline = Date.now() + ( args.timeoutSeconds ?? 600 ) * 1000;
		let project = await readDesignProject( site.path );

		while ( project && project.artifacts.length < minimumArtifacts && Date.now() < deadline ) {
			if ( signal?.aborted ) throw new Error( 'Stopped waiting for design workers.' );
			await new Promise( ( resolve ) => setTimeout( resolve, 1_000 ) );
			project = await readDesignProject( site.path );
		}

		if ( ! project ) throw new Error( 'Design project not found.' );
		return textResult(
			JSON.stringify(
				{
					status: project.artifacts.length >= minimumArtifacts ? 'ready' : 'timed-out',
					artifactCount: project.artifacts.length,
					minimumArtifacts,
					artifacts: project.artifacts.map( ( artifact ) => ( {
						id: artifact.id,
						label: artifact.label,
					} ) ),
				},
				null,
				2
			)
		);
	}
);

export const designArtifactFinalizeTool = defineTool(
	'design_artifact_finalize',
	'Finalizes and registers one generated design direction or a new immutable revision of an existing direction. The HTML must already exist inside the site .studio/design directory. This tool removes scripts, injects the preview CSP, hashes the file, and atomically updates the gallery manifest.',
	{
		nameOrPath: Type.String( { description: 'Studio site name or path' } ),
		relativeIndexPath: Type.String( {
			description: 'Path relative to .studio/design, e.g. artifacts/directions/warm/index.html',
		} ),
		label: Type.String( { description: 'Short human-facing direction name' } ),
		parentArtifactId: Type.Optional(
			Type.String( {
				description:
					'Exact artifact id being revised. Required for a refinement; omit only for a new direction.',
			} )
		),
		rationale: Type.Optional( Type.String( { description: 'One-sentence design rationale' } ) ),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const indexPath = resolveDesignProjectPath( site.path, args.relativeIndexPath );
		const html = await fs.promises.readFile( indexPath, 'utf8' );
		await fs.promises.writeFile( indexPath, injectResourcePolicy( html ) );
		const project = await registerDesignArtifact( {
			sitePath: site.path,
			relativeIndexPath: args.relativeIndexPath,
			label: args.label,
			parentArtifactId: args.parentArtifactId,
			rationale: args.rationale,
		} );
		emitProgress( `Added “${ args.label }” to the design gallery` );
		return textResult( JSON.stringify( project.artifacts.at( -1 ), null, 2 ) );
	}
);

export const designArtifactAcceptTool = defineTool(
	'design_artifact_accept',
	'Accepts the currently selected immutable design direction so it can be materialized into WordPress. Only call after explicit user acceptance.',
	{
		nameOrPath: Type.String( { description: 'Studio site name or path' } ),
		artifactId: Type.String( { description: 'Selected design artifact id' } ),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		return textResult(
			JSON.stringify( await acceptDesignArtifact( site.path, args.artifactId ), null, 2 )
		);
	}
);

export const materializeDesignArtifactTool = defineTool(
	'materialize_design_artifact',
	'Converts an explicitly accepted design artifact into a native editable WordPress block theme and pages using the pinned Static Site Importer.',
	{
		nameOrPath: Type.String( { description: 'Studio site name or path' } ),
		artifactId: Type.String( { description: 'Accepted design artifact id' } ),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const project = await readDesignProject( site.path );
		if ( ! project || project.acceptedArtifactId !== args.artifactId ) {
			throw new Error( 'The requested artifact has not been explicitly accepted.' );
		}
		const artifact = project.artifacts.find( ( candidate ) => candidate.id === args.artifactId );
		if ( ! artifact ) throw new Error( 'Accepted artifact not found.' );
		const sourcePath = resolveDesignProjectPath( site.path, artifact.path );
		const reportRelativePath = `reports/materialization-${ artifact.id }.json`;
		const reportPath = path.join(
			await fs.promises.realpath( getDesignProjectRoot( site.path ) ),
			reportRelativePath
		);
		const themeSlug = `studio-ai-${ project.projectId.slice( 0, 8 ) }`;
		await updateDesignProject( site.path, ( current ) => ( {
			...current,
			phase: 'materializing',
			materialization: { status: 'running', reportPath: null, themeSlug, error: null },
		} ) );

		try {
			emitProgress( 'Preparing the WordPress design importer…' );
			const bundledPlugin = getBundledStaticSiteImporterPath();
			if ( ! fs.existsSync( bundledPlugin ) ) {
				throw new Error(
					'Static Site Importer is not bundled. Run npm install to download wp-files.'
				);
			}
			const pluginTarget = path.join( site.path, 'wp-content', 'plugins', 'static-site-importer' );
			await fs.promises.rm( pluginTarget, { recursive: true, force: true } );
			await fs.promises.cp( bundledPlugin, pluginTarget, { recursive: true } );
			await connectToDaemon();
			try {
				await runWpCli( site, [ 'plugin', 'activate', 'static-site-importer' ] );
				emitProgress( 'Converting the accepted design into editable WordPress blocks…' );
				await runWpCli( site, [
					'static-site-importer',
					'import-theme',
					sourcePath,
					`--slug=${ themeSlug }`,
					`--name=${ site.name }`,
					'--activate',
					'--overwrite',
					`--report=${ reportPath }`,
				] );
			} finally {
				await disconnectFromDaemon();
			}
			await updateDesignProject( site.path, ( current ) => ( {
				...current,
				phase: 'materialized',
				materialization: {
					status: 'applied',
					reportPath: reportRelativePath,
					themeSlug,
					error: null,
				},
			} ) );
			emitProgress( 'Your editable WordPress site is ready' );
			return {
				...textResult( JSON.stringify( { status: 'applied', themeSlug, reportPath }, null, 2 ) ),
				studioArtifacts: [
					{
						type: 'site-preview',
						widgetProps: {
							path: '/',
							siteId: site.id,
							siteName: site.name,
							sitePath: site.path,
							url: getSiteUrl( site ),
						},
					},
				],
			};
		} catch ( error ) {
			const message = error instanceof Error ? error.message : String( error );
			await updateDesignProject( site.path, ( current ) => ( {
				...current,
				phase: 'materialization-failed',
				materialization: { status: 'failed', reportPath: null, themeSlug, error: message },
			} ) );
			throw new Error( `Failed to build the WordPress site: ${ message }` );
		}
	}
);
