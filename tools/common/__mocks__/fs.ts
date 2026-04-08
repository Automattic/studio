import { vol } from 'memfs';
import { createFsMock } from '@studio/common/lib/tests/utils/create-fs-mock';

export { vol };

// memfs uses POSIX paths; normalize Windows-style backslashes so tests work
// under the Windows platform simulation in platformTestSuite.
const toUnixPath = ( p: string | Uint8Array | URL ): string =>
	typeof p === 'string' ? p.replace( /\\/g, '/' ) : String( p );

const mock = createFsMock( toUnixPath );

export default mock;

export const {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	promises,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	watch,
	writeFileSync,
} = mock;
