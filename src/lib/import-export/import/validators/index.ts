import { Validator } from './Validator';
import { JetpackValidator } from './JetpackValidator';

export * from './Validator';
export * from './JetpackValidator';

// Export an array of all validator instances
export const allValidators: Validator[] = [
  new JetpackValidator(),
];
