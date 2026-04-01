/// <reference types="vitest/globals" />

import { vol } from 'memfs';
import { createFsMock } from '@studio/common/lib/tests/utils/create-fs-mock';

export { vol };

const mock = createFsMock();

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
