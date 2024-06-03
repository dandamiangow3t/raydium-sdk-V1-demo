import { BN } from 'bn.js';

import {
  Liquidity,
  Token,
} from '@raydium-io/raydium-sdk';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

import {
  connection,
  FEE_DESTINATION,
  makeTxVersion,
  PROGRAMIDS,
  wallet,
} from '../config';
import {
  buildAndSendTx,
  generateMint,
  getWalletTokenAccount,
  mintToAta,
  sleepTime,
} from './util';
import Decimal from 'decimal.js';
import { createMarket } from './utilsCreateMarket2';
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet';

const ZERO = new BN(0)
type BN = typeof ZERO

type CalcStartPrice = {
  addBaseAmount: BN
  addQuoteAmount: BN
}

type LiquidityPairTargetInfo = {
  baseToken: Token
  quoteToken: Token
  targetMarketId: PublicKey
}

type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>
type TestTxInputInfo = LiquidityPairTargetInfo &
  CalcStartPrice & {
    startTime: number // seconds
    walletTokenAccounts: WalletTokenAccounts
    wallet: Keypair
  }

async function ammCreatePool(input: TestTxInputInfo): Promise<{ txids: string[] }> {
  // -------- step 1: make instructions --------
  const initPoolInstructionResponse = await Liquidity.makeCreatePoolV4InstructionV2Simple({
    connection,
    programId: PROGRAMIDS.AmmV4,
    marketInfo: {
      marketId: input.targetMarketId,
      programId: PROGRAMIDS.OPENBOOK_MARKET,
    },
    baseMintInfo: input.baseToken,
    quoteMintInfo: input.quoteToken,
    baseAmount: input.addBaseAmount,
    quoteAmount: input.addQuoteAmount,
    startTime: new BN(Math.floor(input.startTime)),
    ownerInfo: {
      feePayer: input.wallet.publicKey,
      wallet: input.wallet.publicKey,
      tokenAccounts: input.walletTokenAccounts,
      useSOLBalance: true,
    },
    associatedOnly: false,
    checkCreateATAOwner: true,
    makeTxVersion,
    feeDestinationId: FEE_DESTINATION
  })

  return { txids: await buildAndSendTx(initPoolInstructionResponse.innerTransactions) }
}

async function howToUse() {
  const DECIMALS = 9;
  // MINT_AUTHORITY PubKey 4cUjmQZZBi48xncheZbJWhBjK4XHgTbdEaCmFGk1YQXZ
  const MINT_AUTHORITY = Keypair.fromSecretKey(new Uint8Array([
    37, 166, 225, 234, 112,   8,  88, 216,  51, 231,  74,
   222,  17, 182, 108, 142, 188, 142, 220,  50,  33, 223,
   171, 205, 170, 163,  23, 111, 129, 236,  76, 233,  53,
   169, 192, 118,  77,  93, 198,  29, 222,  38, 191,  97,
    20,  91, 215,  95,  98, 150, 104, 236, 120,  31, 194,
   211, 160,  81, 122,  61, 174, 232, 168, 160
 ]));
  console.log("MintAuthority ", MINT_AUTHORITY.publicKey.toBase58())
  
  const tokenA = await generateMint(MINT_AUTHORITY.publicKey, "MY_USDC", DECIMALS, new PublicKey("F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2"));
  const tokenB = await generateMint(MINT_AUTHORITY.publicKey, "MY_RAY", DECIMALS, new PublicKey("DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD"));
  const tokenC = await generateMint(MINT_AUTHORITY.publicKey, "MY_WSOl", DECIMALS, new PublicKey("8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt"));
  
  console.log("tokenA", tokenA.mint.toBase58())
  console.log("tokenB", tokenB.mint.toBase58())
  console.log("tokenC", tokenC.mint.toBase58())
  
  
  // await mintToAta(MINT_AUTHORITY, tokenA.mint, wallet.publicKey, 1000_000 * Math.pow(10, DECIMALS));
  // await mintToAta(MINT_AUTHORITY, tokenB.mint, wallet.publicKey, 1000_000 * Math.pow(10, DECIMALS));
  // await mintToAta(MINT_AUTHORITY, tokenC.mint, wallet.publicKey, 1000_000 * Math.pow(10, DECIMALS));

  const startTime = Math.floor(Date.now() / 1000) + 60  // start from 7 days later
  const walletTokenAccounts = await getWalletTokenAccount(connection, wallet.publicKey)

  if (false) {
    const targetMarketId1 = await _createMarket(wallet, tokenA, tokenB);
    await ammCreatePool({
      startTime,
      addBaseAmount: new BN(10 * Math.pow(10, DECIMALS)),
      addQuoteAmount: new BN(40 * Math.pow(10, DECIMALS)),
      baseToken: tokenA,
      quoteToken: tokenB,
      targetMarketId: targetMarketId1,
      wallet,
      walletTokenAccounts,
    }).then(({ txids }) => {
      console.log("txIds", txids)
    })
  }
  

  if (false) {
    const targetMarketId2 = await _createMarket(wallet, tokenB, tokenC);
    await ammCreatePool({
      startTime,
      addBaseAmount: new BN(10 * Math.pow(10, DECIMALS)),
      addQuoteAmount: new BN(80 * Math.pow(10, DECIMALS)),
      baseToken: tokenB,
      quoteToken: tokenC,
      targetMarketId: targetMarketId2,
      wallet,
      walletTokenAccounts,
    }).then(({ txids }) => {
      console.log("txIds", txids)
    })
  }
  
  if (true) {
    const targetMarketId3 = await _createMarket(wallet, tokenA, tokenC);
    await ammCreatePool({
      startTime,
      addBaseAmount: new BN(10 * Math.pow(10, DECIMALS)),
      addQuoteAmount: new BN(500 * Math.pow(10, DECIMALS)),
      baseToken: tokenA,
      quoteToken: tokenC,
      targetMarketId: targetMarketId3,
      wallet,
      walletTokenAccounts,
    }).then(({ txids }) => {
      console.log("txIds", txids)
    })
  }
}


async function _createMarket(wallet: Keypair, tokenA: Token, tokenB: Token): Promise<PublicKey> {
  let marketKeyPair = Keypair.generate();
  let targetMarketId = marketKeyPair.publicKey;

  await createMarket({
    connection,
    wallet:  new NodeWallet(wallet),
    baseMint: tokenA.mint,
    quoteMint: tokenB.mint,
    baseLotSize: 1,
    quoteLotSize: 1,
    dexProgram: PROGRAMIDS.OPENBOOK_MARKET,
    market: marketKeyPair,
  });

  return targetMarketId;
}


howToUse();
