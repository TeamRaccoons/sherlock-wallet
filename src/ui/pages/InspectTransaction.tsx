import { Connection, RpcResponseAndContext, SimulatedTransactionResponse, VersionedTransaction } from '@solana/web3.js';
import type { FC } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { rpc } from '../rpc';

const connection = new Connection('https://global.rpc-public.hellomoon.io/', 'confirmed');

const EXPLORER_INSPECT_BASE_URL = 'https://explorer.solana.com/tx/inspector?signatures='

export const InspectTransaction: FC = () => {
  const [transaction, setTransaction] = useState<Uint8Array>();
  const [address, setAddress] = useState<string>();
  const [simulationResult, setSimulationResult] = useState<RpcResponseAndContext<SimulatedTransactionResponse>>();
  const [retrySimulation, setRetrySimulation] = useState(true);
  const versionedTransaction = useMemo(() => {
    if (!transaction) return;
    return VersionedTransaction.deserialize(transaction);
  }, [transaction]);
  console.log(transaction);

  const urlEncodedTransaction = useMemo(() => {
    if (!transaction) return;
    return encodeURIComponent(Buffer.from(transaction).toString('base64'));
  }, [transaction]);

  useEffect(() => {
    rpc.exposeMethod('inspectTransaction', async (params) => {
      const [{ address, transaction: tx }] = params;
      setTransaction(tx);
      setAddress(address);
    });
  }, []);
  useEffect(() => {
    async function simulate() {
      if (!versionedTransaction) return;
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
    return <div>No Transaction</div>;
  }

  return (
    <div>
      Transaction {transaction.length} bytes
      <div>
        {/* This doesn't work */}
        {/* <a href={`${EXPLORER_INSPECT_BASE_URL}${urlEncodedTransaction}`} target="_blank" rel="noopener noreferrer">
          Open in explorer
        </a> */}
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(Buffer.from(transaction).toString('base64'));
          }}
        >
          Copy to clipboard
        </button>
        <button
          onClick={async () => {
            window.close();
          }}
        >
          Close
        </button>
      </div>
      <div>
        <label>Retry simulation (5s)</label>
        <input type="checkbox" checked={retrySimulation} onChange={(e) => setRetrySimulation(!retrySimulation)} />
      </div>
      {simulationResult && (
        <div>
          Status: {simulationResult.value.err?.toString() ?? 'Success'} Slot: {simulationResult.context.slot}
          <div style={{ overflow: 'hidden', maxWidth: '600px' }}>
            {simulationResult.value.logs?.map((log, index) => <p key={index}>{log}</p>)}
          </div>
        </div>
      )}
    </div>
  );
};
