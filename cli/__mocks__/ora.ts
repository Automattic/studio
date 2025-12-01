const mockSpinner = {
	start: jest.fn().mockReturnThis(),
	stop: jest.fn().mockReturnThis(),
	succeed: jest.fn().mockReturnThis(),
	fail: jest.fn().mockReturnThis(),
};

module.exports = jest.fn().mockReturnValue( mockSpinner );
module.exports.default = jest.fn().mockReturnValue( mockSpinner );
