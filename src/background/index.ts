import type { RPC } from '../messages';
import { CONTENT_PORT_NAME, createPortTransport, createRPC, POPUP_PORT_NAME } from '../messages';
import { asyncState } from '../utils/asyncState';
import { openPopup } from '../utils/popup';
import { addAccount, getAccounts, removeAccount } from './storage';

// This allows the background process to communicate with the popup in response
// to content script requests.
const asyncPopupRPC = asyncState<RPC>();
const contentRPC = asyncState<RPC>();

let connectedAccounts: {publicKey: Uint8Array}[] | undefined;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    addAccount({ label: 'Coinbase 2', address: '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm' });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === POPUP_PORT_NAME) {
    const transport = createPortTransport(port);
    const rpc = createRPC(transport);

    rpc.exposeMethod('getAccounts', getAccounts);
    rpc.exposeMethod('addAccount', async (params) => {
      const account = params[0];
      await addAccount(account);
    });
    rpc.exposeMethod('removeAccount', async (params) => {
      const account = params[0];
      await removeAccount(account);
    });
    rpc.exposeMethod('changeAccounts', async (params) => {
      (await contentRPC.get()).callMethod('changeAccounts', params);
    });
    rpc.exposeMethod('connectedAccounts', async () => {
      return connectedAccounts;
    });

    port.onDisconnect.addListener(() => {
      asyncPopupRPC.reset();
      rpc.end();
    });

    asyncPopupRPC.set(rpc);
  }

  if (port.name === CONTENT_PORT_NAME) {
    const transport = createPortTransport(port);
    const rpc = createRPC(transport);

    rpc.exposeMethod('connect', async () => {
      const { closePopup, popupClosed } = await openPopup('approveConnection');

      const popupRPC = await asyncPopupRPC.get();
      const connectResult = popupRPC.callMethod('connect');

      const response = await Promise.race([connectResult, popupClosed]);

      connectedAccounts = response;
      closePopup();

      return response;
    });

    rpc.exposeMethod('signTransaction', async (params) => {
      const { closePopup, popupClosed } = await openPopup('inspectTransaction');

      const popupRPC = await asyncPopupRPC.get();
      await popupRPC.callMethod('inspectTransaction', params);

      const response = await Promise.race([popupClosed]);
      closePopup();
    });

    port.onDisconnect.addListener(() => {
      rpc.end();
    });

    contentRPC.set(rpc);
  }
});
