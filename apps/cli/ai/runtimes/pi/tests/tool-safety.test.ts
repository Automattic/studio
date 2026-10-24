import { describe, expect, it } from 'vitest';
import { getPayloadLimitViolation, STUDIO_FILE_TOOL_MAX_BYTES } from '../tool-safety';

const big = 'x'.repeat( STUDIO_FILE_TOOL_MAX_BYTES + 1 );
const half = 'x'.repeat( Math.ceil( STUDIO_FILE_TOOL_MAX_BYTES / 2 ) );

describe( 'getPayloadLimitViolation', () => {
	it( 'rejects a Write whose content exceeds the limit', () => {
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: big } ) ).toContain(
			'Write content'
		);
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: half } ) ).toBeUndefined();
	} );

	it( 'sums every entry of an Edit call', () => {
		const oneBig = { path: 'a.css', edits: [ { oldText: '/* a */', newText: big } ] };
		expect( getPayloadLimitViolation( 'Edit', oneBig ) ).toContain( 'Edit edits' );

		const twoHalves = {
			path: 'a.css',
			edits: [
				{ oldText: '/* a */', newText: half },
				{ oldText: '/* b */', newText: half },
			],
		};
		expect( getPayloadLimitViolation( 'Edit', twoHalves ) ).toContain( 'Edit edits' );

		const small = {
			path: 'a.css',
			edits: [ { oldText: '/* a */', newText: 'a { color: red; }' } ],
		};
		expect( getPayloadLimitViolation( 'Edit', small ) ).toBeUndefined();
	} );

	it( 'reads an Edit whose edits arrived as a JSON string', () => {
		const params = {
			path: 'a.css',
			edits: JSON.stringify( [ { oldText: '/* a */', newText: big } ] ),
		};
		expect( getPayloadLimitViolation( 'Edit', params ) ).toContain( 'Edit edits' );
	} );

	it( 'ignores Edit calls without a usable edits array', () => {
		expect( getPayloadLimitViolation( 'Edit', { path: 'a.css' } ) ).toBeUndefined();
		expect( getPayloadLimitViolation( 'Edit', { path: 'a.css', edits: '{' } ) ).toBeUndefined();
	} );
} );
