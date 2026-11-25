import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = [ '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs' ];

const exists = ( file ) => fs.statSync( file, { throwIfNoEntry: false } )?.isFile() ?? false;

// Resolves to a source file, or null. Only script files count: like the TypeScript resolver,
// it leaves `.css` and other assets unresolved, so they are never reported.
function resolveFile( base ) {
	const stem = base.replace( /\.(c|m)?jsx?$/, '' );
	const candidates = [
		...( EXTENSIONS.includes( path.extname( base ) ) ? [ base ] : [] ),
		...EXTENSIONS.map( ( ext ) => stem + ext ),
		...EXTENSIONS.map( ( ext ) => path.join( base, `index${ ext }` ) ),
	];
	return candidates.find( exists ) ?? null;
}

// Workspace packages resolve through their `node_modules` link to their own folder.
function resolveWorkspacePackage( specifier, cwd ) {
	const parts = specifier.split( '/' );
	const name = specifier.startsWith( '@' ) ? parts.slice( 0, 2 ).join( '/' ) : parts[ 0 ];
	const link = path.join( cwd, 'node_modules', name );
	let real;
	try {
		real = fs.realpathSync( link );
	} catch {
		return null;
	}
	if ( real.split( path.sep ).includes( 'node_modules' ) ) {
		return null;
	}
	return path.join( real, specifier.slice( name.length ) );
}

function globToRegExp( glob ) {
	let source = '';
	for ( let i = 0; i < glob.length; i++ ) {
		const char = glob[ i ];
		if ( char === '*' && glob[ i + 1 ] === '*' ) {
			source += '.*';
			i++;
		} else if ( char === '*' ) {
			source += '[^/]*';
		} else if ( char === '{' ) {
			const end = glob.indexOf( '}', i );
			source += `(?:${ glob.slice( i + 1, end ).split( ',' ).join( '|' ) })`;
			i = end;
		} else {
			source += char.replace( /[.+?^$()|[\]\\]/g, '\\$&' );
		}
	}
	return new RegExp( `^${ source }(?:/.*)?$` );
}

/**
 * The folder (or file) a glob list matches `file` in, as a path relative to `cwd`, or null.
 * `apps/ui/src/features/*` matches `apps/ui/src/features/sites/list.tsx` in
 * `apps/ui/src/features/sites`.
 */
function matchIn( globs, file ) {
	for ( const glob of globs ) {
		const depth = glob.split( '/' ).length;
		if ( globToRegExp( glob ).test( file ) ) {
			return file.split( '/' ).slice( 0, depth ).join( '/' );
		}
	}
	return null;
}

const pathList = { type: 'array', items: { type: 'string' } };

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Keep the layers of a package apart: some folders may not import others, ' +
				'and some folders are imported only through their entry file.',
		},
		schema: [
			{
				type: 'object',
				properties: {
					aliases: { type: 'object', additionalProperties: { type: 'string' } },
					entries: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								folders: pathList,
								importers: pathList,
								entry: pathList,
								message: { type: 'string' },
							},
							required: [ 'folders', 'importers', 'message' ],
							additionalProperties: false,
						},
					},
					zones: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								target: pathList,
								from: pathList,
								except: pathList,
								message: { type: 'string' },
							},
							required: [ 'target', 'from', 'message' ],
							additionalProperties: false,
						},
					},
				},
				additionalProperties: false,
			},
		],
		messages: { restricted: '{{ message }}' },
	},
	create( context ) {
		const { aliases = {}, entries = [], zones = [] } = context.options[ 0 ] ?? {};
		const cwd = context.cwd ?? process.cwd();
		const relative = ( file ) => path.relative( cwd, file ).split( path.sep ).join( '/' );
		const importer = relative( context.filename );

		const resolve = ( specifier ) => {
			let base = null;
			if ( specifier.startsWith( '.' ) ) {
				base = path.resolve( path.dirname( context.filename ), specifier );
			} else {
				const alias = Object.keys( aliases ).find( ( prefix ) => specifier.startsWith( prefix ) );
				base = alias
					? path.resolve( cwd, aliases[ alias ], specifier.slice( alias.length ) )
					: resolveWorkspacePackage( specifier, cwd );
			}
			const file = base && resolveFile( base );
			return file && relative( file );
		};

		const check = ( node, source ) => {
			if ( ! source || typeof source.value !== 'string' ) {
				return;
			}
			const imported = resolve( source.value );
			if ( ! imported ) {
				return;
			}
			const report = ( message, folder ) =>
				context.report( {
					node: source,
					messageId: 'restricted',
					data: { message: message.replaceAll( '{folder}', folder ?? '' ) },
				} );

			for ( const zone of zones ) {
				if (
					matchIn( zone.target, importer ) &&
					matchIn( zone.from, imported ) &&
					! matchIn( zone.except ?? [], imported )
				) {
					report( zone.message );
				}
			}
			for ( const rule of entries ) {
				const folder = matchIn( rule.folders, imported );
				if (
					folder &&
					matchIn( rule.importers, importer ) &&
					! importer.startsWith( `${ folder }/` ) &&
					! ( rule.entry ?? [ 'index.ts' ] ).some( ( entry ) => imported === `${ folder }/${ entry }` )
				) {
					report( rule.message, folder );
				}
			}
		};

		return {
			ImportDeclaration: ( node ) => check( node, node.source ),
			ExportNamedDeclaration: ( node ) => check( node, node.source ),
			ExportAllDeclaration: ( node ) => check( node, node.source ),
			ImportExpression: ( node ) => check( node, node.source ),
			CallExpression: ( node ) => {
				if ( node.callee.type === 'Identifier' && node.callee.name === 'require' ) {
					check( node, node.arguments[ 0 ] );
				}
			},
		};
	},
};
