import { registerWallet } from '@wallet-standard/core';
import { createRPC, createWindowTransport } from '../messages';
import { SherlockWallet } from './SherlockWallet';

function register(): void {
  const transport = createWindowTransport(window);
  const rpc = createRPC(transport);
  registerWallet(new SherlockWallet(rpc));
}

register();
