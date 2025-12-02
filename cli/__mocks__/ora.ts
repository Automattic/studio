function mockOra() {
	return {
		start: jest.fn().mockReturnThis(),
		stop: jest.fn().mockReturnThis(),
		succeed: jest.fn().mockReturnThis(),
		fail: jest.fn().mockReturnThis(),
	};
}

module.exports = mockOra;
module.exports.default = mockOra;
