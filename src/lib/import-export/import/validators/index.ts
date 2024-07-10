import { JetpackValidator } from './JetpackValidator';
import { Validator } from './Validator';

export * from './Validator';
export * from './JetpackValidator';

// Export an array of all validator instances
export const allValidators: Validator[] = [ new JetpackValidator() ];
