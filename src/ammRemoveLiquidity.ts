import assert from 'assert';

import {
  buildTransaction,
  ENDPOINT,
  jsonInfo2PoolKeys,
  Liquidity,
  LiquidityPoolKeys,
  Token,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import { PublicKey } from '@solana/web3.js';

import {
  connection,
  RAYDIUM_MAINNET_API,
  wallet,
  wantBuildTxVersion,
} from '../config';
import {
  getWalletTokenAccount,
  sendTx,
} from './util';

async function ammRemoveLiquidity() {
  // target pool public key string, in this example, USDC-RAY pool
  const targetPoolPublicKeyString = 'EVzLJhqMtdC1nPmz8rNd6xGfVjDPxpLZgq7XJuNfMZ6';
  // get pool list
  const ammPool = await (await fetch(ENDPOINT + RAYDIUM_MAINNET_API.poolInfo)).json(); // If the Liquidity pool is not required for routing, then this variable can be configured as undefined
  // get target pool
  const targetPoolInfos = [...ammPool.official, ...ammPool.unOfficial].filter(
    (info) => info.id === targetPoolPublicKeyString
  );

  assert(targetPoolInfos.length > 0, 'cannot find the target pool');

  const targetPoolInfo = targetPoolInfos[0];

  const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;

  // get wallet token accounts
  const walletTokenAccountFormat = await getWalletTokenAccount(connection, wallet.publicKey);

  // prepare remove token amount
  const lpToken = new Token(
    new PublicKey('FGYXP4vBkMEtKhxrmEBcWN8VNmXX8qNgEJpENKDETZ4Y'),
    6,
    'RAY-USDC',
    'RAY-USDC'
  );
  const inputTokenAmount = new TokenAmount(lpToken, 100);

  // prepare instruction
  const removeLiquidityInstructionResponse = await Liquidity.makeRemoveLiquidityInstructionSimple({
    connection,
    poolKeys,
    userKeys: { owner: wallet.publicKey, payer: wallet.publicKey, tokenAccounts: walletTokenAccountFormat },
    amountIn: inputTokenAmount,
  });

  // prepare transactions
  const removeLiquidityInstructionTransactions = await buildTransaction({
    connection,
    txType: wantBuildTxVersion,
    payer: wallet.publicKey,
    innerTransactions: removeLiquidityInstructionResponse.innerTransactions,
  });

  // send transactions
  const txids = await sendTx(connection, wallet, wantBuildTxVersion, removeLiquidityInstructionTransactions);
  console.log(txids);
}

ammRemoveLiquidity();
