/// <reference types="vitest/globals" />

import { vol } from 'memfs';
import { createFsMock } from '@studio/common/lib/tests/utils/create-fs-mock';

export { vol };

const mock = createFsMock();

const readdirSync = vi.fn();
mock.readdirSync = readdirSync;

const rename = vi.fn();
mock.promises.rename = rename;

export default mock;

export const {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	promises,
	readFileSync,
	statSync,
	unlinkSync,
	watch,
	writeFileSync,
} = mock;

export { readdirSync };
