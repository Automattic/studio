import { vi } from 'vitest';

function mockOra() {
	return {
		start: vi.fn().mockReturnThis(),
		stop: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
	};
}

export default mockOra;
export { mockOra };
