import path from 'path';

type PlatformConfig = {
	name: string;
	join: typeof path.join;
	normalize: typeof path.normalize;
	basename: typeof path.basename;
	relative: typeof path.relative;
	sep: typeof path.sep;
};

export const platforms: PlatformConfig[] = [
	{
		name: 'Unix',
		join: path.posix.join,
		normalize: path.posix.normalize,
		basename: path.posix.basename,
		relative: path.posix.relative,
		sep: path.posix.sep,
	},
	{
		name: 'Windows',
		join: path.win32.join,
		normalize: path.win32.normalize,
		basename: path.win32.basename,
		relative: path.win32.relative,
		sep: path.win32.sep,
	},
];

// Create a test suite that runs twice, once with a Unix platform `path` module, and once with a
// Windows platform `path` module. Any code that uses `path` should be tested with this approach.
export function platformTestSuite(
	name: string,
	testFn: ( platform: PlatformConfig ) => void
): void {
	const pathOverrides = {
		originalJoin: path.join,
		originalNormalize: path.normalize,
		originalBasename: path.basename,
		originalRelative: path.relative,
		originalSeparator: path.sep,
	};

	describe.each( platforms )( `${ name } on $name`, ( platform ) => {
		beforeEach( () => {
			path.join = platform.join;
			path.normalize = platform.normalize;
			path.basename = platform.basename;
			path.relative = platform.relative;
			// @ts-expect-error - Temporarily override path.sep
			path.sep = platform.sep;
		} );

		afterEach( () => {
			path.join = pathOverrides.originalJoin;
			path.normalize = pathOverrides.originalNormalize;
			path.basename = pathOverrides.originalBasename;
			path.relative = pathOverrides.originalRelative;
			// @ts-expect-error - Restore original path.sep
			path.sep = pathOverrides.originalSeparator;
		} );

		testFn( platform );
	} );
}
