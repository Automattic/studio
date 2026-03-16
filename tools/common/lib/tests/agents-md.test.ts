import { AGENTS_MD_TEMPLATE, AGENTS_MD_FILE_NAME } from '../agents-md';

describe( 'AGENTS_MD_TEMPLATE', () => {
	it( 'should export a non-empty template string', () => {
		expect( AGENTS_MD_TEMPLATE ).toBeTruthy();
		expect( typeof AGENTS_MD_TEMPLATE ).toBe( 'string' );
	} );

	it( 'should export the correct file name', () => {
		expect( AGENTS_MD_FILE_NAME ).toBe( 'AGENTS.md' );
	} );

	describe( 'version control section', () => {
		it( 'should include the version control heading', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '## Version Control' );
		} );

		it( 'should include git init instructions', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( 'git init' );
			expect( AGENTS_MD_TEMPLATE ).toContain( 'git add -A' );
		} );

		it( 'should include checkpoint workflow', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( 'Pre-modification checkpoint' );
		} );

		it( 'should include revert instructions', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( 'git checkout .' );
			expect( AGENTS_MD_TEMPLATE ).toContain( 'git revert HEAD' );
		} );

		it( 'should include a recommended .gitignore', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '.gitignore' );
			expect( AGENTS_MD_TEMPLATE ).toContain( '/wp-admin/' );
			expect( AGENTS_MD_TEMPLATE ).toContain( '/wp-includes/' );
			expect( AGENTS_MD_TEMPLATE ).toContain( 'wp-content/database/' );
		} );
	} );

	describe( 'quality checks section', () => {
		it( 'should include the quality checks heading', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '## Quality Checks' );
		} );

		it( 'should include PHP error checking', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( 'debug.log' );
		} );

		it( 'should include site health verification', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( 'studio wp option get siteurl' );
		} );

		it( 'should include site analysis commands', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain(
				'studio wp theme list --status=active --format=json'
			);
			expect( AGENTS_MD_TEMPLATE ).toContain(
				'studio wp plugin list --status=active --format=json'
			);
			expect( AGENTS_MD_TEMPLATE ).toContain( 'theme.json' );
		} );
	} );

	describe( 'existing sections preserved', () => {
		it( 'should still contain managing this site section', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '## Managing This Site' );
		} );

		it( 'should still contain development best practices', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '## WordPress Development Best Practices' );
		} );

		it( 'should still contain SQLite documentation', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '## Database: SQLite (not MySQL)' );
		} );

		it( 'should still contain studio-specific notes', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain( '## Studio-Specific Notes' );
		} );

		it( 'should still use studio wp instead of bare wp', () => {
			expect( AGENTS_MD_TEMPLATE ).toContain(
				'Always use `studio wp` instead of a standalone `wp` binary'
			);
		} );
	} );
} );
