import { RpcResponseAndContext, SimulatedTransactionResponse, VersionedTransaction } from '@solana/web3.js';
import base58 from 'bs58';
import type { FC } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { useConnection } from '../context/ConnectionContext';
import { rpc } from '../rpc';

const EXPLORER_INSPECT_BASE_URL = 'https://explorer.solana.com/tx/inspector';

export const InspectTransaction: FC = () => {
  const { connection } = useConnection();
  const [transaction, setTransaction] = useState<Uint8Array>();
  const [address, setAddress] = useState<string>();
  const [simulationResult, setSimulationResult] = useState<RpcResponseAndContext<SimulatedTransactionResponse>>();
  const [retrySimulation, setRetrySimulation] = useState(true);
  const versionedTransaction = useMemo(() => {
    if (!transaction) return;
    return VersionedTransaction.deserialize(transaction);
  }, [transaction]);
  console.log(transaction);

  const explorerInspectUrl = useMemo(() => {
    if (!versionedTransaction) return;
    const url = new URL(EXPLORER_INSPECT_BASE_URL);
    const message = encodeURIComponent(Buffer.from(versionedTransaction.message.serialize()).toString('base64'));
    url.searchParams.append(
      'signatures',
      encodeURIComponent(JSON.stringify(versionedTransaction.signatures.map((sig) => base58.encode(sig))))
    );
    url.searchParams.append('message', message);
    return url.toString();
  }, [versionedTransaction]);

  useEffect(() => {
    rpc.exposeMethod('inspectTransaction', async (params) => {
      const [{ address, transaction: tx }] = params;
      setTransaction(tx);
      setAddress(address);
    });
  }, []);
  
  useEffect(() => {
    async function simulate() {
      if (!versionedTransaction || !connection) return;
      const simulationResult = await connection.simulateTransaction(versionedTransaction, { sigVerify: false });
      setSimulationResult(simulationResult);
    }
    simulate();
    let cleanup = () => {};
    if (retrySimulation) {
      const timerId = setInterval(() => {
        simulate();
      }, 5_000);
      cleanup = () => clearInterval(timerId);
    }
    return cleanup;
  }, [versionedTransaction, retrySimulation]);

  if (!transaction || !versionedTransaction) {
    return (
      <div className="bg-slate-900 text-card-foreground shadow-sm flex flex-col space-y-6 p-6 min-h-screen">
        <h1 className="text-2xl font-semibold leading-none tracking-tight text-center">No Transaction</h1>
        <button
          onClick={async () => {
            window.close();
          }}
          className="!mt-auto inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen p-6 flex flex-col justify-between">
      <div>
        <h1 className="mt-12 text-lg font-semibold leading-none tracking-tight text-center">Transaction</h1>

        <div className="flex flex-col gap-2 text-sm space-y-2">
          <div className="flex justify-between">
            <div>Size:</div>
            <div>{transaction.length} bytes</div>
          </div>

          <div className="flex gap-4">
            <a
              href={explorerInspectUrl ?? ''}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Open explorer
            </a>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(Buffer.from(transaction).toString('base64'));
              }}
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Copy to clipboard
            </button>
          </div>

          <div className="flex space-x-2">
            <input
              id="simulate"
              type="checkbox"
              checked={retrySimulation}
              onChange={(e) => setRetrySimulation(!retrySimulation)}
              className="h-4 w-4 rounded border-gray-300 text-slate-600 focus:ring-slate-600"
            />
            <label
              htmlFor="simutlate"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Retry simulation (5s)
            </label>
          </div>
        </div>

        {simulationResult && (
          <details className="cursor-pointer p-4 mt-4 max-h-[220px] overflow-hidden bg-black rounded-lg">
            <summary className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-center">
              Status: {simulationResult.value.err?.toString() ?? 'Success'} Slot: {simulationResult.context.slot}
            </summary>
            
            <div className="flex justify-center mt-2 pb-6">
              <div className="font-mono space-y-2 overflow-auto max-h-[200px]">
                {simulationResult.value.logs?.map((log, index) => (
                  <p key={index} className="text-ellipsis overflow-hidden whitespace-nowrap">
                    {log}
                  </p>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>

      <button
        type="button"
        onClick={async () => {
          window.close();
        }}
        className="min-h-[40px] inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
      >
        Close
      </button>
    </div>
  );
};
