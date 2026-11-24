import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateBlocks } from '@studio/agent/node/block-validator';
import { openPage } from '@studio/agent/node/pages';

vi.mock( '@studio/agent/node/pages', () => ( { openPage: vi.fn() } ) );

const report = { totalBlocks: 0, validBlocks: 0, invalidBlocks: 0, results: [] };

function mockEditorPage() {
	const page = {
		waitForFunction: vi.fn(),
		evaluate: vi.fn().mockResolvedValue( { report } ),
		isClosed: () => false,
		close: vi.fn().mockResolvedValue( undefined ),
	};
	vi.mocked( openPage ).mockResolvedValue( page as never );
	return page;
}

describe( 'validateBlocks', () => {
	afterEach( () => {
		vi.useRealTimers();
		vi.mocked( openPage ).mockReset();
	} );

	it( 'closes the block editor page after two minutes without a validation', async () => {
		vi.useFakeTimers();
		const page = mockEditorPage();

		await validateBlocks( '', 'http://localhost:8883' );
		await vi.advanceTimersByTimeAsync( 119_000 );
		expect( page.close ).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync( 1000 );
		expect( page.close ).toHaveBeenCalledTimes( 1 );

		await validateBlocks( '', 'http://localhost:8883' );
		expect( openPage ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'keeps the block editor page open while validations continue', async () => {
		vi.useFakeTimers();
		const page = mockEditorPage();

		await validateBlocks( '', 'http://localhost:8884' );
		await vi.advanceTimersByTimeAsync( 90_000 );
		await validateBlocks( '', 'http://localhost:8884' );
		await vi.advanceTimersByTimeAsync( 90_000 );

		expect( page.close ).not.toHaveBeenCalled();
		expect( openPage ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not close the block editor page during a long validation', async () => {
		vi.useFakeTimers();
		const page = mockEditorPage();
		await validateBlocks( '', 'http://localhost:8885' );

		let finish: ( value: unknown ) => void = () => {};
		page.evaluate.mockReturnValue( new Promise( ( resolve ) => ( finish = resolve ) ) );
		const running = validateBlocks( '', 'http://localhost:8885' );
		await vi.advanceTimersByTimeAsync( 50_000 );
		expect( page.close ).not.toHaveBeenCalled();

		finish( { report } );
		await expect( running ).resolves.toEqual( report );
	} );

	it( 'loads the block editor once for concurrent validations', async () => {
		mockEditorPage();

		const reports = await Promise.all(
			[ 1, 2, 3 ].map( () => validateBlocks( '', 'http://localhost:8882' ) )
		);

		expect( reports ).toEqual( [ report, report, report ] );
		expect( openPage ).toHaveBeenCalledTimes( 1 );
		expect( openPage ).toHaveBeenCalledWith( {
			url: 'http://localhost:8882/wp-admin/post-new.php',
			signIn: true,
		} );
	} );
} );
