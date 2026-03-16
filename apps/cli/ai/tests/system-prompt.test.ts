import { buildSystemPrompt } from '../system-prompt';

describe( 'buildSystemPrompt', () => {
	const prompt = buildSystemPrompt();

	it( 'should return a non-empty string', () => {
		expect( prompt ).toBeTruthy();
		expect( typeof prompt ).toBe( 'string' );
	} );

	describe( 'workflow routing', () => {
		it( 'should route "create" requests to the creation workflow', () => {
			expect( prompt ).toContain( 'follow the **Creation workflow**' );
		} );

		it( 'should route existing site requests to the modification workflow', () => {
			expect( prompt ).toContain( 'follow the **Modification workflow**' );
		} );
	} );

	describe( 'creation workflow', () => {
		it( 'should include git initialization step', () => {
			expect( prompt ).toContain( 'git init' );
			expect( prompt ).toContain( 'Initial WordPress installation' );
		} );

		it( 'should include quality verification step', () => {
			expect( prompt ).toContain(
				'**Verify quality**: Run the quality checks described in the Quality Verification section'
			);
		} );

		it( 'should include final commit step', () => {
			expect( prompt ).toContain( '**Commit your work**: Run `git add -A && git commit' );
		} );
	} );

	describe( 'modification workflow', () => {
		it( 'should include site analysis step', () => {
			expect( prompt ).toContain( '**Analyze the existing site**' );
		} );

		it( 'should instruct reading theme.json', () => {
			expect( prompt ).toContain( 'theme.json' );
			expect( prompt ).toContain( 'design system' );
		} );

		it( 'should instruct checking active plugins', () => {
			expect( prompt ).toContain( 'plugin list --status=active --format=json' );
		} );

		it( 'should include safety checkpoint step', () => {
			expect( prompt ).toContain( '**Create a safety checkpoint**' );
			expect( prompt ).toContain( 'Pre-modification checkpoint' );
		} );

		it( 'should include before/after screenshot comparison', () => {
			expect( prompt ).toContain( '**Capture the current state**' );
			expect( prompt ).toContain( '**Compare before and after**' );
		} );

		it( 'should instruct targeted changes only', () => {
			expect( prompt ).toContain( '**Make targeted changes**' );
			expect( prompt ).toContain( 'Only modify what the user asked for' );
		} );

		it( 'should include revert instructions', () => {
			expect( prompt ).toContain( 'git revert HEAD' );
		} );
	} );

	describe( 'quality verification', () => {
		it( 'should include PHP error checking', () => {
			expect( prompt ).toContain( 'debug.log' );
			expect( prompt ).toContain( 'PHP errors' );
		} );

		it( 'should include site health verification', () => {
			expect( prompt ).toContain( 'option get siteurl' );
			expect( prompt ).toContain( 'WordPress is responding' );
		} );

		it( 'should include block validation', () => {
			expect( prompt ).toContain( 'run validate_blocks' );
		} );
	} );

	describe( 'existing sections preserved', () => {
		it( 'should still contain design guidelines', () => {
			expect( prompt ).toContain( '## Design guidelines' );
		} );

		it( 'should still contain block content guidelines', () => {
			expect( prompt ).toContain( '## Block content guidelines' );
		} );

		it( 'should still contain available studio tools', () => {
			expect( prompt ).toContain( '## Available Studio Tools' );
		} );

		it( 'should still contain general rules', () => {
			expect( prompt ).toContain( '## General rules' );
		} );
	} );
} );
