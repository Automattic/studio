import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

export type LinkExtensionKind = 'plugin' | 'theme';

export interface LinkedExtension {
	name: string;
	sourcePath: string;
}

async function runLinkCli( args: string[], logPrefix: string ): Promise< { stdout: string } > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix } );
		emitter.on( 'success', ( { result } ) => {
			resolve( { stdout: result?.stdout ?? '' } );
		} );
		emitter.on( 'failure', ( { error } ) => {
			reject( error );
		} );
		emitter.on( 'error', ( { error } ) => {
			reject( error );
		} );
	} );
}

export async function listLinkedExtensionsViaCli(
	kind: LinkExtensionKind,
	sitePath: string
): Promise< LinkedExtension[] > {
	const { stdout } = await runLinkCli(
		[ '--path', sitePath, kind, 'list-linked', '--format', 'json' ],
		sitePath
	);
	const trimmed = stdout.trim();
	if ( ! trimmed ) {
		return [];
	}
	const parsed: unknown = JSON.parse( trimmed );
	if ( ! Array.isArray( parsed ) ) {
		return [];
	}
	return parsed.filter(
		( item ): item is LinkedExtension =>
			typeof item === 'object' &&
			item !== null &&
			typeof ( item as LinkedExtension ).name === 'string' &&
			typeof ( item as LinkedExtension ).sourcePath === 'string'
	);
}

export async function linkExtensionViaCli(
	kind: LinkExtensionKind,
	sitePath: string,
	sourcePath: string
): Promise< void > {
	await runLinkCli( [ '--path', sitePath, kind, 'link', sourcePath ], sitePath );
}

export async function unlinkExtensionViaCli(
	kind: LinkExtensionKind,
	sitePath: string,
	name: string
): Promise< void > {
	await runLinkCli( [ '--path', sitePath, kind, 'unlink', name ], sitePath );
}
