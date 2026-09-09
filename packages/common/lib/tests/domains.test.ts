/**
 * @vitest-environment node
 */
import { stripLocalDomainSuffix } from '@studio/common/lib/domains';

describe( 'stripLocalDomainSuffix', () => {
	it( 'strips the default .wp.local suffix entirely', () => {
		expect( stripLocalDomainSuffix( 'mysite.wp.local' ) ).toBe( 'mysite' );
	} );

	it( 'strips a single trailing .local label', () => {
		expect( stripLocalDomainSuffix( 'mysite.local' ) ).toBe( 'mysite' );
	} );

	it( 'keeps inner labels when stripping .local', () => {
		expect( stripLocalDomainSuffix( 'mysite.com.local' ) ).toBe( 'mysite.com' );
	} );

	it( 'only strips the suffix, not inner occurrences', () => {
		expect( stripLocalDomainSuffix( 'wp.local.mysite.local' ) ).toBe( 'wp.local.mysite' );
	} );

	it( 'leaves non-local domains unchanged', () => {
		expect( stripLocalDomainSuffix( 'mysite.com' ) ).toBe( 'mysite.com' );
	} );
} );
