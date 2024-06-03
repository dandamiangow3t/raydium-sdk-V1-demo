import {
  MarketV2,
  Token,
} from '@raydium-io/raydium-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';

import {
  connection,
  DEFAULT_TOKEN,
  makeTxVersion,
  PROGRAMIDS,
  wallet,
} from '../config';
import { buildAndSendTx, sleepTime } from './util';

type TestTxInputInfo = {
  baseToken: Token
  quoteToken: Token
  wallet: Keypair
}

export async function createMarket(input: TestTxInputInfo) {
  // -------- step 1: make instructions --------
  const createMarketInstruments = await MarketV2.makeCreateMarketInstructionSimple({
    connection,
    wallet: input.wallet.publicKey,
    baseInfo: input.baseToken,
    quoteInfo: input.quoteToken,
    lotSize: 1, // default 1
    tickSize: 0.01, // default 0.01
    dexProgramId: PROGRAMIDS.OPENBOOK_MARKET,
    makeTxVersion,
  })

  // await buildAndSendTx(createMarketInstruments.innerTransactions) }

  const marketId = createMarketInstruments.address.marketId;

  const tx = await buildAndSendTx(createMarketInstruments.innerTransactions, wallet, { skipPreflight: true });

  await checkMarketIdExists(marketId);

  return marketId;
}

export async function checkMarketIdExists(marketId: PublicKey): Promise<any> { 
  let marketAccountInfo;

  do {
    marketAccountInfo = await connection.getAccountInfo(marketId);
    console.log(marketAccountInfo);
    await sleepTime(1000)
  } while (!marketAccountInfo);

} 

async function howToUse() {
  const baseToken = DEFAULT_TOKEN.RAY // RAY
  const quoteToken = DEFAULT_TOKEN.USDC // USDC

  createMarket({
    baseToken,
    quoteToken,
    wallet: wallet,
  }).then(({ txids }) => {
    /** continue with txids */
    console.log('txids', txids)
  })
}
