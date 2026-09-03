import type { BillingProvider } from '../provider';
import { TbcBillingProvider } from './tbc';

let tbcProvider: BillingProvider | null = null;

export function getBillingProvider(id = 'tbc'): BillingProvider {
  if (id !== 'tbc') throw new Error(`Unsupported billing provider: ${id}`);
  if (!tbcProvider) tbcProvider = new TbcBillingProvider();
  return tbcProvider;
}

export function setBillingProviderForTests(provider: BillingProvider | null): void {
  tbcProvider = provider;
}
