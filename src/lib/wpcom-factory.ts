import wpcomModule from 'wpcom';

// Normalize for both ESM (Vite/browser) and CJS (Electron IPC) contexts.
/* eslint-disable @typescript-eslint/no-explicit-any */
const wpcomFactory: any =
	typeof wpcomModule === 'function' ? wpcomModule : ( wpcomModule as any ).default ?? wpcomModule;

export default wpcomFactory;
/* eslint-enable @typescript-eslint/no-explicit-any */
