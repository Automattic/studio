// What `trash` resolves to in the Node processes `env.mjs` runs as an agent (see `agent-hooks.mjs`):
// it deletes the paths for good instead of moving them to the owner's Trash, and logs each one to
// `$RP_STUDIO_TRASH_LOG`. It refuses the paths whose loss would hurt beyond the agent's own files:
// the filesystem root, the owner's home and its ancestors, the owner's own Studio data and Trash,
// a git checkout, and the worktree the agent works in or any folder holding it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.userInfo().homedir;
const OWNER = [ '.studio', 'Studio', '.Trash' ].map( ( name ) => path.join( HOME, name ) );

function inside( child, parent ) {
	const relative = path.relative( parent, child );
	return relative === '' || ( ! relative.startsWith( '..' ) && ! path.isAbsolute( relative ) );
}

function refusal( target ) {
	if ( target === path.parse( target ).root || inside( HOME, target ) ) {
		return 'it holds the home folder';
	}
	if ( OWNER.some( ( folder ) => inside( target, folder ) ) ) {
		return "it is the owner's own Studio data or Trash";
	}
	const worktree = process.env.RP_STUDIO_ROOT;
	if ( worktree && inside( worktree, target ) ) {
		return 'it holds the worktree';
	}
	if ( fs.existsSync( path.join( target, '.git' ) ) ) {
		return 'it is a git checkout';
	}
	return null;
}

function record( line ) {
	if ( process.env.RP_STUDIO_TRASH_LOG ) {
		try {
			fs.appendFileSync(
				process.env.RP_STUDIO_TRASH_LOG,
				`${ new Date().toISOString() } ${ line }\n`
			);
		} catch {}
	}
}

// Tells a check that this is the shim, not `trash`.
export const isTrashShim = true;

export default async function trash( paths ) {
	const targets = ( typeof paths === 'string' ? [ paths ] : [ ...paths ] ).map( ( item ) =>
		path.resolve( String( item ) )
	);
	for ( const target of targets ) {
		const reason = refusal( target );
		if ( reason ) {
			record( `refused ${ target }: ${ reason }` );
			throw new Error( `env.mjs refused to delete ${ target }: ${ reason }.` );
		}
	}
	for ( const target of targets ) {
		record( `deleted ${ target }` );
		await fs.promises.rm( target, { recursive: true, force: true, maxRetries: 3 } );
	}
}
