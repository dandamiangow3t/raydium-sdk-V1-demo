import BN from 'bn.js';

import {
  ApiClmmPoolsItem,
  ApiPoolInfo,
  Clmm,
  Currency,
  CurrencyAmount,
  fetchMultipleMintInfos,
  Percent,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAmount,
  TradeV2
} from '@raydium-io/raydium-sdk';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
} from '@solana/web3.js';

import {
  connection,
  makeTxVersion,
  PROGRAMIDS,
  wallet
} from '../config';
import { formatAmmKeysToApi } from './formatAmmKeys';
import { formatClmmKeys } from './formatClmmKeys';
import {
  buildAndSendTx,
  getWalletTokenAccount,
} from './util';

type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>
type TestTxInputInfo = {
  inputToken: Token | Currency
  outputToken: Token | Currency
  inputTokenAmount: TokenAmount | CurrencyAmount
  slippage: Percent
  walletTokenAccounts: WalletTokenAccounts
  wallet: Keypair

  feeConfig?: {
    feeBps: BN,
    feeAccount: PublicKey
  }
}

async function routeSwap(input: TestTxInputInfo) {
  // -------- pre-action: fetch Clmm pools info and ammV2 pools info --------
  const clmmPools: ApiClmmPoolsItem[] = await formatClmmKeys(PROGRAMIDS.CLMM.toString()) // If the clmm pool is not required for routing, then this variable can be configured as undefined
  const clmmList = Object.values(
    await Clmm.fetchMultiplePoolInfos({ connection, poolKeys: clmmPools, chainTime: new Date().getTime() / 1000 })
  ).map((i) => i.state)
  // console.log("clmmPools %s", clmmPools.length)

  const sPool: ApiPoolInfo = await formatAmmKeysToApi(PROGRAMIDS.AmmV4.toString(), true) // If the Liquidity pool is not required for routing, then this variable can be configured as undefined
  // console.log("sPool official %s, unOfficial %s", sPool.official.length, sPool.unOfficial.length)
  // -------- step 1: get all route --------
  const getRoute = TradeV2.getAllRoute({
    inputMint: input.inputToken instanceof Token ? input.inputToken.mint : PublicKey.default,
    outputMint: input.outputToken instanceof Token ? input.outputToken.mint : PublicKey.default,
    apiPoolList: sPool,
    clmmList,
  })
  // console.log('getAllRoute', getRoute)

  // -------- step 2: fetch tick array and pool info --------
  // const [tickCache, poolInfosCache] = await Promise.all([
  //   await Clmm.fetchMultiplePoolTickArrays({ connection, poolKeys: getRoute.needTickArray, batchRequest: true }),
  //   await TradeV2.fetchMultipleInfo({ connection, pools: getRoute.needSimulate, batchRequest: true }),
  // ])
  const tickCache = await Clmm.fetchMultiplePoolTickArrays({ connection, poolKeys: getRoute.needTickArray, batchRequest: true })
  // console.log("tickCache", tickCache)
  // console.log("getRoute %s", getRoute)
  // console.log("getRoute.direcPath length", getRoute.directPath.length)
  // console.log("getRoute.directPath[0]", getRoute.directPath[0])
  // console.log("getRoute.addLiquidityPools length", getRoute.addLiquidityPools.length)
  // console.log("getRoute.addLiquidityPools[0]", getRoute.addLiquidityPools[0])
  
  // console.log("getRoute.needSimulate size %s", getRoute.needSimulate.length)
  // console.log("getRoute.needSimulate", getRoute.needSimulate)
  const poolInfosCache = await TradeV2.fetchMultipleInfo({ connection, pools: getRoute.needSimulate, batchRequest: true })
  // console.log("poolInfosCache", poolInfosCache)

  // console.log("tickCache", tickCache)

  // -------- step 3: calculation result of all route --------
  const [routeInfo] = TradeV2.getAllRouteComputeAmountOut({
    directPath: getRoute.directPath,
    routePathDict: getRoute.routePathDict,
    simulateCache: poolInfosCache,
    tickCache,
    inputTokenAmount: input.inputTokenAmount,
    outputToken: input.outputToken,
    slippage: input.slippage,
    chainTime: new Date().getTime() / 1000, // this chain time

    feeConfig: input.feeConfig,

    mintInfos: await fetchMultipleMintInfos({connection, mints: [
      ...clmmPools.map(i => [{mint: i.mintA, program: i.mintProgramIdA}, {mint: i.mintB, program: i.mintProgramIdB}]).flat().filter(i => i.program === TOKEN_2022_PROGRAM_ID.toString()).map(i => new PublicKey(i.mint)),
    ]}),

    epochInfo: await connection.getEpochInfo(),
  })
  console.log("routeInfo", routeInfo)
  // -------- step 4: create instructions by SDK function --------
  const { innerTransactions } = await TradeV2.makeSwapInstructionSimple({
    routeProgram: PROGRAMIDS.Router,
    connection,
    swapInfo: routeInfo,
    ownerInfo: {
      wallet: input.wallet.publicKey,
      tokenAccounts: input.walletTokenAccounts,
      associatedOnly: true,
      checkCreateATAOwner: true,
    },
    
    computeBudgetConfig: { // if you want add compute instruction
      units: 400000, // compute instruction
      microLamports: 1, // fee add 1 * 400000 / 10 ** 9 SOL
    },
    makeTxVersion,
  })

  innerTransactions.map((it, i) => {
    it.instructions.map((ix, j) => { 
      console.log("Tx %s/Ix %s %s", i, j, ix)
      ix.keys.map((key, k) => console.log("\tKey %s %s", k, key))
    })
  })

  return {txids: ["fake"]}
  // return { txids: await buildAndSendTx(innerTransactions) }
}

async function howToUse() {
  // sol -> new Currency(9, 'SOL', 'SOL')
  // const outputToken = DEFAULT_TOKEN.USDC // USDC
  // const inputToken = DEFAULT_TOKEN.RAY // RAY

  // MintAuthority  4cUjmQZZBi48xncheZbJWhBjK4XHgTbdEaCmFGk1YQXZ
  // tokenA F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2
  // tokenB DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD
  // tokenC 8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt

  // const inputToken = new Token(TOKEN_PROGRAM_ID,
  //   new PublicKey("F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2"), 9, "MY_RAY");
  // const outputToken = new Token(TOKEN_PROGRAM_ID,
  //   new PublicKey("8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt"), 9, "MY_SOL");

  const inputToken = new Token(TOKEN_PROGRAM_ID,
    new PublicKey("8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt"), 9, "MY_SOL");
  const outputToken = new Token(TOKEN_PROGRAM_ID,
    new PublicKey("F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2"), 9, "MY_RAY");

  // const inputToken = new Currency(9, 'SOL', 'SOL')

  const inputTokenAmount = new (inputToken instanceof Token ? TokenAmount : CurrencyAmount)(inputToken, 100)
  const slippage = new Percent(1, 100)
  const walletTokenAccounts = await getWalletTokenAccount(connection, wallet.publicKey)

  routeSwap({
    inputToken,
    outputToken,
    inputTokenAmount,
    slippage,
    walletTokenAccounts,
    wallet,

    // feeConfig: {
    //   feeBps: new BN(25),
    //   feeAccount: Keypair.generate().publicKey // test
    // }
  }).then(({ txids }) => {
    /** continue with txids */
    console.log('txids', txids)
  })
}

howToUse();


// Example output
// clmmPools 675
// sPool official 0, unOfficial 11733
// tickCache {}
// getRoute {
//   directPath: [Array],
//   addLiquidityPools: [Array],
//   routePathDict: [Object],
//   needSimulate: [Array],
//   needTickArray: [],
//   needCheckToken: []
// }
// getRoute.direcPath length 1
// getRoute.directPath[0] {
//   id: 'GPnKEqbnotvqAAhnmkT4a72TVZw71JkUT993h3mRxYBi',
//   baseMint: 'F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2',
//   quoteMint: '8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt',
//   lpMint: 'HnBgcL5k4QyZSUZcNBaJnhXQX8vw1af5BWksozFL6VNi',
//   baseDecimals: 9,
//   quoteDecimals: 9,
//   lpDecimals: 9,
//   version: 4,
//   programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//   authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//   openOrders: 'FHMgNgPxXNk6xkTDDKvHD7Pwx8qK9ByBcXUxJHq4QZh9',
//   targetOrders: '8veYYkV4nJGgXvnXHniwabHwarnNWs6qxJN29NHy9fNr',
//   baseVault: '9Kmyso64vJQXx4192mCF2MdQn8yuE4JsETBhPkShXiYg',
//   quoteVault: '6FofGBKgRZdnszHAD7HBqXfANe8HYq17aVTbVfsLAP21',
//   withdrawQueue: '11111111111111111111111111111111',
//   lpVault: '11111111111111111111111111111111',
//   marketVersion: 3,
//   marketId: 'HwN5Nqpaov53B9mPL8obNZZJEkEN7qED4gS9gub6udkY',
//   marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//   marketAuthority: 'B9xQABKNG1Nnk2ceD97rnuJuworDcZxq7o1rQesc6KJ9',
//   marketBaseVault: '8CAoZn5SUnmDn8EdpTwxGQVn71jp8JZza2CDJNfbCiVV',
//   marketQuoteVault: '42AXqQHvFNA8rjFX1CRk1conNHZyib9oE3yBTioAdpyd',
//   marketBids: 'GAv2CCjo69p7N8z1U6JNGhyXQj4J5eoMXqHjLGTAHKP',
//   marketAsks: 'BMgb7vtuPisJC2DQrkqQJEXn9fU9sAsxHQGpotHMPPWo',
//   marketEventQueue: 'DQiyP6AGntVtuopwPm5YrtYzFF5a3x9sqnCo4jBSw6XZ',
//   lookupTableAccount: '11111111111111111111111111111111'
// }
// getRoute.addLiquidityPools length 1
// getRoute.addLiquidityPools[0] {
//   id: 'GPnKEqbnotvqAAhnmkT4a72TVZw71JkUT993h3mRxYBi',
//   baseMint: 'F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2',
//   quoteMint: '8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt',
//   lpMint: 'HnBgcL5k4QyZSUZcNBaJnhXQX8vw1af5BWksozFL6VNi',
//   baseDecimals: 9,
//   quoteDecimals: 9,
//   lpDecimals: 9,
//   version: 4,
//   programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//   authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//   openOrders: 'FHMgNgPxXNk6xkTDDKvHD7Pwx8qK9ByBcXUxJHq4QZh9',
//   targetOrders: '8veYYkV4nJGgXvnXHniwabHwarnNWs6qxJN29NHy9fNr',
//   baseVault: '9Kmyso64vJQXx4192mCF2MdQn8yuE4JsETBhPkShXiYg',
//   quoteVault: '6FofGBKgRZdnszHAD7HBqXfANe8HYq17aVTbVfsLAP21',
//   withdrawQueue: '11111111111111111111111111111111',
//   lpVault: '11111111111111111111111111111111',
//   marketVersion: 3,
//   marketId: 'HwN5Nqpaov53B9mPL8obNZZJEkEN7qED4gS9gub6udkY',
//   marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//   marketAuthority: 'B9xQABKNG1Nnk2ceD97rnuJuworDcZxq7o1rQesc6KJ9',
//   marketBaseVault: '8CAoZn5SUnmDn8EdpTwxGQVn71jp8JZza2CDJNfbCiVV',
//   marketQuoteVault: '42AXqQHvFNA8rjFX1CRk1conNHZyib9oE3yBTioAdpyd',
//   marketBids: 'GAv2CCjo69p7N8z1U6JNGhyXQj4J5eoMXqHjLGTAHKP',
//   marketAsks: 'BMgb7vtuPisJC2DQrkqQJEXn9fU9sAsxHQGpotHMPPWo',
//   marketEventQueue: 'DQiyP6AGntVtuopwPm5YrtYzFF5a3x9sqnCo4jBSw6XZ',
//   lookupTableAccount: '11111111111111111111111111111111'
// }
// getRoute.needSimulate size 3
// getRoute.needSimulate [
//   {
//     id: 'GPnKEqbnotvqAAhnmkT4a72TVZw71JkUT993h3mRxYBi',
//     baseMint: 'F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2',
//     quoteMint: '8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt',
//     lpMint: 'HnBgcL5k4QyZSUZcNBaJnhXQX8vw1af5BWksozFL6VNi',
//     baseDecimals: 9,
//     quoteDecimals: 9,
//     lpDecimals: 9,
//     version: 4,
//     programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//     authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//     openOrders: 'FHMgNgPxXNk6xkTDDKvHD7Pwx8qK9ByBcXUxJHq4QZh9',
//     targetOrders: '8veYYkV4nJGgXvnXHniwabHwarnNWs6qxJN29NHy9fNr',
//     baseVault: '9Kmyso64vJQXx4192mCF2MdQn8yuE4JsETBhPkShXiYg',
//     quoteVault: '6FofGBKgRZdnszHAD7HBqXfANe8HYq17aVTbVfsLAP21',
//     withdrawQueue: '11111111111111111111111111111111',
//     lpVault: '11111111111111111111111111111111',
//     marketVersion: 3,
//     marketId: 'HwN5Nqpaov53B9mPL8obNZZJEkEN7qED4gS9gub6udkY',
//     marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//     marketAuthority: 'B9xQABKNG1Nnk2ceD97rnuJuworDcZxq7o1rQesc6KJ9',
//     marketBaseVault: '8CAoZn5SUnmDn8EdpTwxGQVn71jp8JZza2CDJNfbCiVV',
//     marketQuoteVault: '42AXqQHvFNA8rjFX1CRk1conNHZyib9oE3yBTioAdpyd',
//     marketBids: 'GAv2CCjo69p7N8z1U6JNGhyXQj4J5eoMXqHjLGTAHKP',
//     marketAsks: 'BMgb7vtuPisJC2DQrkqQJEXn9fU9sAsxHQGpotHMPPWo',
//     marketEventQueue: 'DQiyP6AGntVtuopwPm5YrtYzFF5a3x9sqnCo4jBSw6XZ',
//     lookupTableAccount: '11111111111111111111111111111111'
//   },
//   {
//     id: '8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm',
//     baseMint: 'DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD',
//     quoteMint: '8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt',
//     lpMint: '8w9bC6kb5yGJsURNjzoRDmK1zDrRaznxMwRgS5r51YYa',
//     baseDecimals: 9,
//     quoteDecimals: 9,
//     lpDecimals: 9,
//     version: 4,
//     programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//     authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//     openOrders: '5c7rwNkZR8LUvNsMpTdsc8iqn9VGm2ezQsBbRVQgqgFm',
//     targetOrders: 'Bb9tUByg77GQDWFTywYZcbdFL4S7mix35CuUNV8EWtLV',
//     baseVault: 'FfiXjCE871pw2v1GPEy1NHKrYKZ3SaHLWK9PP1dtXdpi',
//     quoteVault: 'Cdjm3E8nN2v34yQSJBhuYm9utP8dDVgSEUXe5hwoEVch',
//     withdrawQueue: '11111111111111111111111111111111',
//     lpVault: '11111111111111111111111111111111',
//     marketVersion: 3,
//     marketId: 'ApLfEFZeWfjBmbLvNcZ5R8eZThgdVF3GZ5WVbEqLXRFK',
//     marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//     marketAuthority: '98z1iDwUqajqPWsrs7VEdsULzueg9UBdagbQERCcHAwn',
//     marketBaseVault: 'GR3mHY8Wdt4Rp2dhGuLVySThipUk434Qv9sg8UGKX88h',
//     marketQuoteVault: '86EqS3RJBUMtu8kbJfBXwVZaBpE5rKRxoS7aEotaL2wg',
//     marketBids: 'EN3cTgvhAUTQoEfcWuRndhMxyCP8XT2oSpJDkyA2QnB1',
//     marketAsks: '6SpzSSPdotmzCFi7KVtsj6SiVyaDPzoDnCDiS8P9WN45',
//     marketEventQueue: '3k8y8W7dx5qnYZWEATgqu3RWtKqBw5eWqWEowKeg8tyG',
//     lookupTableAccount: '11111111111111111111111111111111'
//   },
//   {
//     id: 'G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j',
//     baseMint: 'F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2',
//     quoteMint: 'DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD',
//     lpMint: 'jpujvWR4Jg6DUGkXVFCyCY55hEegvUY6LFgGK7FSiMa',
//     baseDecimals: 9,
//     quoteDecimals: 9,
//     lpDecimals: 9,
//     version: 4,
//     programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//     authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//     openOrders: '6iTq83RVpkeU9BeZr8C2hiYFbZmZC9No6nQteS3nvmrU',
//     targetOrders: '8HVmFrhpdX1TKPL2jcMNBZoUVJqc9RrbcVdZDcX1wyBb',
//     baseVault: '2TuvkJ6KRsU3Va94sZGFHTGmDZFn9y6NwSYL4XGnqGmG',
//     quoteVault: 'B6eJ9SVGbccyNZBpGSFSD13Moo2EJTgt5kqNirM5EGvU',
//     withdrawQueue: '11111111111111111111111111111111',
//     lpVault: '11111111111111111111111111111111',
//     marketVersion: 3,
//     marketId: 'HSJLGZRAXchAm6z8YsBe4HwKgqLC3AqsTBsahgifaGDU',
//     marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//     marketAuthority: 'AFDNk7Wxxh4VBh5Sgi2t8hWL7jX2dBqAsvvDH2K3hnR7',
//     marketBaseVault: '8czEG5E8mJPJmUS5hb9PBwAK1fjypJMEVFqVZsao3Pyz',
//     marketQuoteVault: 'HdrhJGouHntftyUAXc2mTfqQvd4HkmrejvpT6verJnBF',
//     marketBids: 'Hce8smUECaTgRuoDKBofRyUpbqFQewgVUMT4FJeZfnWF',
//     marketAsks: '8EYTgGSj5qgrzGJqJhpf6X5Er4wQeT3uH4E4azbr3VjF',
//     marketEventQueue: '7rvy4uYmP35wZmr9gZeyNQaaaVazjCw3DKgf8YECZ1Qy',
//     lookupTableAccount: '11111111111111111111111111111111'
//   }
// ]
// poolInfosCache {
//   GPnKEqbnotvqAAhnmkT4a72TVZw71JkUT993h3mRxYBi: {
//     ammId: 'GPnKEqbnotvqAAhnmkT4a72TVZw71JkUT993h3mRxYBi',
//     status: <BN: 6>,
//     baseDecimals: 9,
//     quoteDecimals: 9,
//     lpDecimals: 9,
//     baseReserve: <BN: 2540be464>,
//     quoteReserve: <BN: 746a527479>,
//     lpSupply: <BN: 1076af5266>,
//     startTime: <BN: 665dfa87>
//   },
//   '8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm': {
//     ammId: '8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm',
//     status: <BN: 7>,
//     baseDecimals: 9,
//     quoteDecimals: 9,
//     lpDecimals: 9,
//     baseReserve: <BN: 2540be400>,
//     quoteReserve: <BN: 12a05f2000>,
//     lpSupply: <BN: 695dfba8f>,
//     startTime: <BN: 665df9b1>
//   },
//   G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j: {
//     ammId: 'G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j',
//     status: <BN: 7>,
//     baseDecimals: 9,
//     quoteDecimals: 9,
//     lpDecimals: 9,
//     baseReserve: <BN: 2540be400>,
//     quoteReserve: <BN: 9502f9000>,
//     lpSupply: <BN: 4a817c800>,
//     startTime: <BN: 665df93f>
//   }
// }
// tickCache {}
// routeInfo {
//   allTrade: true,
//   amountIn: {
//     amount: TokenAmount {
//       numerator: <BN: 64>,
//       denominator: <BN: 3b9aca00>,
//       currency: [Token],
//       token: [Token]
//     },
//     fee: undefined,
//     expirationTime: undefined
//   },
//   amountOut: {
//     amount: TokenAmount {
//       numerator: <BN: 2>,
//       denominator: <BN: 3b9aca00>,
//       currency: [Token],
//       token: [Token]
//     },
//     fee: undefined,
//     expirationTime: undefined
//   },
//   minAmountOut: {
//     amount: TokenAmount {
//       numerator: <BN: 1>,
//       denominator: <BN: 3b9aca00>,
//       currency: [Token],
//       token: [Token]
//     },
//     fee: undefined,
//     expirationTime: undefined
//   },
//   currentPrice: undefined,
//   executionPrice: Price {
//     numerator: <BN: 2>,
//     denominator: <BN: 64>,
//     baseCurrency: Token {
//       decimals: 9,
//       symbol: 'MY_RAY',
//       name: 'UNKNOWN',
//       programId: [PublicKey [PublicKey(TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)]],
//       mint: [PublicKey [PublicKey(8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt)]]
//     },
//     quoteCurrency: Token {
//       decimals: 9,
//       symbol: 'MY_SOL',
//       name: 'UNKNOWN',
//       programId: [PublicKey [PublicKey(TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)]],
//       mint: [PublicKey [PublicKey(F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2)]]
//     },
//     scalar: Fraction { numerator: <BN: 3b9aca00>, denominator: <BN: 3b9aca00> }
//   },
//   priceImpact: Fraction {
//     numerator: <BN: 6fceeff6681b2a00000>,
//     denominator: <BN: 170f7b179f1267100000>
//   },
//   fee: [
//     TokenAmount {
//       numerator: <BN: 1>,
//       denominator: <BN: 3b9aca00>,
//       currency: [Token],
//       token: [Token]
//     },
//     TokenAmount {
//       numerator: <BN: 1>,
//       denominator: <BN: 3b9aca00>,
//       currency: [Token],
//       token: [Token]
//     }
//   ],
//   routeType: 'route',
//   poolKey: [
//     {
//       id: '8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm',
//       baseMint: 'DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD',
//       quoteMint: '8Vu9PcgZVrBN4YZwFSffnZyGyKKD5kmjM5XiX3ky7nYt',
//       lpMint: '8w9bC6kb5yGJsURNjzoRDmK1zDrRaznxMwRgS5r51YYa',
//       baseDecimals: 9,
//       quoteDecimals: 9,
//       lpDecimals: 9,
//       version: 4,
//       programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//       authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//       openOrders: '5c7rwNkZR8LUvNsMpTdsc8iqn9VGm2ezQsBbRVQgqgFm',
//       targetOrders: 'Bb9tUByg77GQDWFTywYZcbdFL4S7mix35CuUNV8EWtLV',
//       baseVault: 'FfiXjCE871pw2v1GPEy1NHKrYKZ3SaHLWK9PP1dtXdpi',
//       quoteVault: 'Cdjm3E8nN2v34yQSJBhuYm9utP8dDVgSEUXe5hwoEVch',
//       withdrawQueue: '11111111111111111111111111111111',
//       lpVault: '11111111111111111111111111111111',
//       marketVersion: 3,
//       marketId: 'ApLfEFZeWfjBmbLvNcZ5R8eZThgdVF3GZ5WVbEqLXRFK',
//       marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//       marketAuthority: '98z1iDwUqajqPWsrs7VEdsULzueg9UBdagbQERCcHAwn',
//       marketBaseVault: 'GR3mHY8Wdt4Rp2dhGuLVySThipUk434Qv9sg8UGKX88h',
//       marketQuoteVault: '86EqS3RJBUMtu8kbJfBXwVZaBpE5rKRxoS7aEotaL2wg',
//       marketBids: 'EN3cTgvhAUTQoEfcWuRndhMxyCP8XT2oSpJDkyA2QnB1',
//       marketAsks: '6SpzSSPdotmzCFi7KVtsj6SiVyaDPzoDnCDiS8P9WN45',
//       marketEventQueue: '3k8y8W7dx5qnYZWEATgqu3RWtKqBw5eWqWEowKeg8tyG',
//       lookupTableAccount: '11111111111111111111111111111111'
//     },
//     {
//       id: 'G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j',
//       baseMint: 'F4e82K1Rg5k3uT6vjXY7rDr78gPLZRhroh9UnWn6WU2',
//       quoteMint: 'DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD',
//       lpMint: 'jpujvWR4Jg6DUGkXVFCyCY55hEegvUY6LFgGK7FSiMa',
//       baseDecimals: 9,
//       quoteDecimals: 9,
//       lpDecimals: 9,
//       version: 4,
//       programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
//       authority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
//       openOrders: '6iTq83RVpkeU9BeZr8C2hiYFbZmZC9No6nQteS3nvmrU',
//       targetOrders: '8HVmFrhpdX1TKPL2jcMNBZoUVJqc9RrbcVdZDcX1wyBb',
//       baseVault: '2TuvkJ6KRsU3Va94sZGFHTGmDZFn9y6NwSYL4XGnqGmG',
//       quoteVault: 'B6eJ9SVGbccyNZBpGSFSD13Moo2EJTgt5kqNirM5EGvU',
//       withdrawQueue: '11111111111111111111111111111111',
//       lpVault: '11111111111111111111111111111111',
//       marketVersion: 3,
//       marketId: 'HSJLGZRAXchAm6z8YsBe4HwKgqLC3AqsTBsahgifaGDU',
//       marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
//       marketAuthority: 'AFDNk7Wxxh4VBh5Sgi2t8hWL7jX2dBqAsvvDH2K3hnR7',
//       marketBaseVault: '8czEG5E8mJPJmUS5hb9PBwAK1fjypJMEVFqVZsao3Pyz',
//       marketQuoteVault: 'HdrhJGouHntftyUAXc2mTfqQvd4HkmrejvpT6verJnBF',
//       marketBids: 'Hce8smUECaTgRuoDKBofRyUpbqFQewgVUMT4FJeZfnWF',
//       marketAsks: '8EYTgGSj5qgrzGJqJhpf6X5Er4wQeT3uH4E4azbr3VjF',
//       marketEventQueue: '7rvy4uYmP35wZmr9gZeyNQaaaVazjCw3DKgf8YECZ1Qy',
//       lookupTableAccount: '11111111111111111111111111111111'
//     }
//   ],
//   remainingAccounts: [ undefined, undefined ],
//   minMiddleAmountFee: undefined,
//   middleToken: Token {
//     decimals: 9,
//     symbol: 'UNKNOWN',
//     name: 'UNKNOWN',
//     programId: PublicKey [PublicKey(TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)] {
//       _bn: <BN: 6ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9>
//     },
//     mint: PublicKey [PublicKey(DpxcUEecYsCn4UWr1ZEN8pmBNN1k4AK6C6dao66kqRxD)] {
//       _bn: <BN: be956bdb653e9ded232f9cca64e5de5d13e2ad494e937d4f42b19239fb36d472>
//     }
//   },
//   poolReady: true,
//   poolType: [ undefined, undefined ],
//   feeConfig: undefined,
//   expirationTime: undefined,
//   slippage: Percent { numerator: <BN: 1>, denominator: <BN: 64> },
//   clmmExPriceX64: [ undefined, undefined ]
// }
// Tx 0/Ix 0 TransactionInstruction {
//   keys: [],
//   programId: [PublicKey [PublicKey(ComputeBudget111111111111111111111111111111)]],
//   data: <Buffer 03 01 00 00 00 00 00 00 00>
// }
// Tx 0/Ix 1 TransactionInstruction {
//   keys: [],
//   programId: [PublicKey [PublicKey(ComputeBudget111111111111111111111111111111)]],
//   data: <Buffer 02 80 1a 06 00>
// }
// Tx 0/Ix 2 TransactionInstruction {
//   keys: [Array],
//   programId: [PublicKey [PublicKey(BVChZ3XFEwTMUk1o9i3HAf91H6mFxSwa5X2wFAWhYPhU)]],
//   data: <Buffer 08 64 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00>
// }
//         Key 0 {
//   pubkey: [PublicKey [PublicKey(ExGPApCgzZWkGGJgNsGERvSWPGTjgcRvxuckoP5hnNxr)]],
//   isSigner: true,
//   isWritable: false
// }
//         Key 1 {
//   pubkey: [PublicKey [PublicKey(TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 2 {
//   pubkey: [PublicKey [PublicKey(HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 3 {
//   pubkey: [PublicKey [PublicKey(CRL82x98T6AiMdBDy2TX6VpMPRjr5FWPCTnCieLjgmYY)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 4 {
//   pubkey: [PublicKey [PublicKey(J6237oZjhp7gxDeo2MrEJL1M3ZNQ4sHX8kUDff41ivF6)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 5 {
//   pubkey: [PublicKey [PublicKey(8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 6 {
//   pubkey: [PublicKey [PublicKey(DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 7 {
//   pubkey: [PublicKey [PublicKey(EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 8 {
//   pubkey: [PublicKey [PublicKey(98z1iDwUqajqPWsrs7VEdsULzueg9UBdagbQERCcHAwn)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 9 {
//   pubkey: [PublicKey [PublicKey(5c7rwNkZR8LUvNsMpTdsc8iqn9VGm2ezQsBbRVQgqgFm)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 10 {
//   pubkey: [PublicKey [PublicKey(FfiXjCE871pw2v1GPEy1NHKrYKZ3SaHLWK9PP1dtXdpi)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 11 {
//   pubkey: [PublicKey [PublicKey(Cdjm3E8nN2v34yQSJBhuYm9utP8dDVgSEUXe5hwoEVch)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 12 {
//   pubkey: [PublicKey [PublicKey(ApLfEFZeWfjBmbLvNcZ5R8eZThgdVF3GZ5WVbEqLXRFK)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 13 {
//   pubkey: [PublicKey [PublicKey(EN3cTgvhAUTQoEfcWuRndhMxyCP8XT2oSpJDkyA2QnB1)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 14 {
//   pubkey: [PublicKey [PublicKey(6SpzSSPdotmzCFi7KVtsj6SiVyaDPzoDnCDiS8P9WN45)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 15 {
//   pubkey: [PublicKey [PublicKey(3k8y8W7dx5qnYZWEATgqu3RWtKqBw5eWqWEowKeg8tyG)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 16 {
//   pubkey: [PublicKey [PublicKey(8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 17 {
//   pubkey: [PublicKey [PublicKey(8w2Utw2x4cvyLiaD5pXBgCjfA9ma1STDd8WWyFNSGfzm)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 18 {
//   pubkey: [PublicKey [PublicKey(HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 19 {
//   pubkey: [PublicKey [PublicKey(J6237oZjhp7gxDeo2MrEJL1M3ZNQ4sHX8kUDff41ivF6)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 20 {
//   pubkey: [PublicKey [PublicKey(3kmKtAKJCsAvyazzWQKosUGYrcQWmaUhWW5e25nMDy2U)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 21 {
//   pubkey: [PublicKey [PublicKey(G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 22 {
//   pubkey: [PublicKey [PublicKey(DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 23 {
//   pubkey: [PublicKey [PublicKey(EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 24 {
//   pubkey: [PublicKey [PublicKey(AFDNk7Wxxh4VBh5Sgi2t8hWL7jX2dBqAsvvDH2K3hnR7)]],
//   isSigner: false,
//   isWritable: false
// }
//         Key 25 {
//   pubkey: [PublicKey [PublicKey(6iTq83RVpkeU9BeZr8C2hiYFbZmZC9No6nQteS3nvmrU)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 26 {
//   pubkey: [PublicKey [PublicKey(2TuvkJ6KRsU3Va94sZGFHTGmDZFn9y6NwSYL4XGnqGmG)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 27 {
//   pubkey: [PublicKey [PublicKey(B6eJ9SVGbccyNZBpGSFSD13Moo2EJTgt5kqNirM5EGvU)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 28 {
//   pubkey: [PublicKey [PublicKey(HSJLGZRAXchAm6z8YsBe4HwKgqLC3AqsTBsahgifaGDU)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 29 {
//   pubkey: [PublicKey [PublicKey(Hce8smUECaTgRuoDKBofRyUpbqFQewgVUMT4FJeZfnWF)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 30 {
//   pubkey: [PublicKey [PublicKey(8EYTgGSj5qgrzGJqJhpf6X5Er4wQeT3uH4E4azbr3VjF)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 31 {
//   pubkey: [PublicKey [PublicKey(7rvy4uYmP35wZmr9gZeyNQaaaVazjCw3DKgf8YECZ1Qy)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 32 {
//   pubkey: [PublicKey [PublicKey(G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j)]],
//   isSigner: false,
//   isWritable: true
// }
//         Key 33 {
//   pubkey: [PublicKey [PublicKey(G6RA2qANEZSd8dU1Su6NUaQkKQDyoNse2hvCtf8ebF5j)]],
//   isSigner: false,
//   isWritable: true
// }