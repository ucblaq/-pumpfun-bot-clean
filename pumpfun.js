import { VersionedTransaction } from '@solana/web3.js';

export async function createPumpFunToken({
  connection,
  creatorKeypair,
  mintKeypair,
  name,
  symbol,
  uri,
  devBuySol,
}) {
  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: creatorKeypair.publicKey.toBase58(),
      action: 'create',
      tokenMetadata: { name, symbol, uri },
      mint: mintKeypair.publicKey.toBase58(),
      denominatedInSol: 'true',
      amount: devBuySol > 0 ? devBuySol : 0,
      slippage: 10,
      priorityFee: 0.00005,
      pool: 'pump',
    }),
  });

  if (!res.ok) {
    throw new Error(`PumpPortal request failed (${res.status}): ${await res.text()}`);
  }

  const txBytes = new Uint8Array(await res.arrayBuffer());
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([mintKeypair, creatorKeypair]);

  const signature = await connection.sendTransaction(tx);
  await connection.confirmTransaction(signature, 'confirmed');

  return { signature, mint: mintKeypair.publicKey.toBase58() };
}
