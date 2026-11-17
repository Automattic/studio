import fs from 'node:fs';
import path from 'node:path';

const DESCRIPTOR_IMPORT = /^\.\/([^/]+)\/descriptor(\.ts)?$/;

// Every node of an ESTree AST, depth first.
function* walk( node ) {
	if ( ! node || typeof node.type !== 'string' ) {
		return;
	}
	yield node;
	for ( const [ key, value ] of Object.entries( node ) ) {
		if ( key === 'parent' ) {
			continue;
		}
		for ( const child of Array.isArray( value ) ? value : [ value ] ) {
			if ( child && typeof child === 'object' ) {
				yield* walk( child );
			}
		}
	}
}

/**
 * The registration's entries: each identifier listed in an array of `registry.ts` that names a
 * provider folder's descriptor, with the folder it comes from.
 */
function readRegistration( ast ) {
	const folders = new Map();
	for ( const node of ast.body ) {
		const folder =
			node.type === 'ImportDeclaration' && DESCRIPTOR_IMPORT.exec( node.source.value )?.[ 1 ];
		if ( folder ) {
			for ( const specifier of node.specifiers ) {
				folders.set( specifier.local.name, folder );
			}
		}
	}
	const entries = [];
	for ( const node of walk( ast ) ) {
		if ( node.type !== 'ArrayExpression' ) {
			continue;
		}
		for ( const element of node.elements ) {
			if ( element?.type === 'Identifier' && folders.has( element.name ) ) {
				entries.push( { node: element, folder: folders.get( element.name ) } );
			}
		}
	}
	return entries;
}

// The folders the package's registration lists, read with the parser ESLint lints with.
function readRegisteredFolders( context, registryPath ) {
	const { parser } = context.languageOptions;
	const code = fs.readFileSync( registryPath, 'utf8' );
	const options = {
		ecmaVersion: 'latest',
		sourceType: 'module',
		filePath: registryPath,
		range: true,
		loc: true,
		tokens: true,
		comment: true,
	};
	const ast = parser.parseForESLint
		? parser.parseForESLint( code, options ).ast
		: parser.parse( code, options );
	return new Set( readRegistration( ast ).map( ( { folder } ) => folder ) );
}

// Whether `node` exports a variable, named `name` when given, made by calling `helper`.
function declares( node, name, helper ) {
	return (
		node.type === 'ExportNamedDeclaration' &&
		node.declaration?.type === 'VariableDeclaration' &&
		node.declaration.declarations.some(
			( declarator ) =>
				( ! name || ( declarator.id.type === 'Identifier' && declarator.id.name === name ) ) &&
				declarator.init?.type === 'CallExpression' &&
				declarator.init.callee.type === 'Identifier' &&
				declarator.init.callee.name === helper
		)
	);
}

/**
 * Checks each provider folder of `@studio/providers` against its registration, so a provider that
 * passes lint is listed in every surface and runs: the registration (`registry.ts`) lists its
 * descriptor, its folder has a `services.ts`, and that module exports `services` made with
 * `defineServices()`, which the services entry reads. Lint `registry.ts`, each folder's
 * `descriptor.ts` and each folder's `services.ts` with it.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require every provider folder of @studio/providers to be registered, with services the services entry reads',
		},
		schema: [],
		messages: {
			unregistered:
				'The "{{ folder }}" provider isn’t registered: append its descriptor to the list in registry.ts.',
			missingServices:
				'The "{{ folder }}" provider has no services: add {{ folder }}/services.ts, which exports `services` from defineServices().',
			servicesExport:
				'Export the provider’s services as `export const services = defineServices( descriptor, { … } )`: the services entry reads that export.',
		},
	},
	create( context ) {
		const filename = context.filename;
		const folderPath = path.dirname( filename );
		const file = path.basename( filename );

		if ( file === 'registry.ts' ) {
			return {
				Program( program ) {
					for ( const { node, folder } of readRegistration( program ) ) {
						if ( ! fs.existsSync( path.join( folderPath, folder, 'services.ts' ) ) ) {
							context.report( { node, messageId: 'missingServices', data: { folder } } );
						}
					}
				},
			};
		}

		if ( file === 'descriptor.ts' ) {
			const registryPath = path.join( path.dirname( folderPath ), 'registry.ts' );
			const folder = path.basename( folderPath );
			return {
				Program( program ) {
					if (
						fs.existsSync( registryPath ) &&
						! readRegisteredFolders( context, registryPath ).has( folder )
					) {
						context.report( {
							node:
								program.body.find( ( node ) => declares( node, undefined, 'defineProvider' ) ) ??
								program,
							messageId: 'unregistered',
							data: { folder },
						} );
					}
				},
			};
		}

		if ( file === 'services.ts' ) {
			return {
				Program( program ) {
					if ( ! program.body.some( ( node ) => declares( node, 'services', 'defineServices' ) ) ) {
						context.report( {
							node: program.body.find( ( node ) => node.type.startsWith( 'Export' ) ) ?? program,
							messageId: 'servicesExport',
						} );
					}
				},
			};
		}

		return {};
	},
};
