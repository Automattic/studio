import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { it } from 'vitest';
import { validateBlockMarkup } from '@studio/agent/node/block-validation-gate';
it( 'prints', async () => {
	const out: string[] = [];
	for ( const f of readdirSync( '/tmp/bis' ).sort() ) {
		const r = await validateBlockMarkup( readFileSync( '/tmp/bis/' + f, 'utf8' ), f, 'http://localhost:8881' );
		out.push( r.summary + ' fixed=' + ( r.fixedContent ? 'yes' : 'no' ) + '\n' + ( r.problem ?? '' ).split( '\n' ).filter( ( l ) => /^\s+- /.test( l ) ).join( '\n' ).slice( 0, 600 ) );
	}
	writeFileSync( '/tmp/zz-align.log', out.join( '\n' ) );
}, 300000 );
