/**
 * Answers of the M^0 Orchestration API, as the live service gives them through the Portal's
 * proxy (`https://portal.fluent.xyz/api/m0`), field for field: the list writes chain
 * ids as strings and pads some addresses to 32 bytes, and the single-order read writes chain ids
 * as numbers and pads the others. A long hex value is split across lines and joined, nothing
 * else is edited unless a constant says so.
 */

/** `POST /quote` for 100 USDC, Ethereum to Fluent, sender and recipient `0x…dEaD`. */
export const ORDER_API_QUOTE_100_USDC = [
  {
    route: {
      source: {
        chain: "Ethereum",
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      },
      destination: {
        chain: "Fluent",
        address: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
      },
    },
    amountIn: "100000000",
    recipient: "0x000000000000000000000000000000000000dEaD",
    amountOut: "99000000",
    estFillTime: 60,
    payloads: [
      {
        provider: "limit-order",
        annotation: "Approve USDC for OrderBook",
        data: {
          type: "evm",
          chain: "Ethereum",
          chainId: 1,
          to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          data: [
            "0x095ea7b3000000000000000000000000e39b012ab3b20e94a9beea557eb0de4171d4d3e4000000",
            "0000000000000000000000000000000000000000000000000005f5e100",
          ].join(""),
          value: "0",
        },
      },
      {
        provider: "limit-order",
        annotation: "Limit Order: USDC → USDnr",
        data: {
          type: "evm",
          chain: "Ethereum",
          chainId: 1,
          to: "0xe39B012AB3b20E94a9beEa557eB0DE4171D4D3E4",
          data: [
            "0x3c48b0a20000000000000000000000000000000000000000000000000000000000006313000000",
            "000000000000000000000000000000000000000000000000006af6c9db0000000000000000000000",
            "00a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000d48e565561416d",
            "e59da1050ed70b8d75e8ef28f9000000000000000000000000000000000000000000000000000000",
            "0005f5e1000000000000000000000000000000000000000000000000000000000005e69ec0000000",
            "000000000000000000000000000000000000000000000000000000dead0000000000000000000000",
            "0012e9b6c507ed27eae9cc55910b862de26925827b00000000000000000000000000000000000000",
            "0000000000000000000000dead",
          ].join(""),
          value: "0",
        },
        solver: {
          address: "0x12E9B6C507Ed27eaE9Cc55910B862de26925827B",
          name: "Farsight Solver",
          exclusive: true,
          feeBps: 0,
        },
      },
    ],
  },
];

/**
 * `POST /quote` for 1 USDC: HTTP 404, the solver's fee leaves nothing to deliver. The answer's
 * `requestId` is left out.
 */
export const ORDER_API_NO_QUOTE = {
  code: "NoQuotesAvailable",
  message: "No quotes available for USDC (Ethereum) → USDnr (Fluent) (amountIn=1000000). ",
};

/** `GET /orders?originChainId=1&limit=3`: two wallets' orders, newest first. */
export const ORDER_API_ORDERS = {
  orders: [
    {
      orderId: "0x96200fe4d729350b4b84ad5f840946c82f44e064b6510b34bb7758749f1f4f5a",
      createdAt: 1794341939,
      originChainId: "1",
      sender: "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df",
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amountIn: "3000000",
      destChainId: "25363",
      tokenOut: "0x000000000000000000000000d48e565561416de59da1050ed70b8d75e8ef28f9",
      amountOut: "2000000",
      designatedSolver: "0x00000000000000000000000012e9b6c507ed27eae9cc55910b862de26925827b",
      openTx: "0x001c17cae0212556278b56782a3f5a39fad32b64689d377e6ac78999bccb719b",
      amountOutFilled: "2000000",
      fillCount: "1",
      amountInReleased: "3000000",
      fillReportCount: "1",
      amountRefunded: "0",
      status: "COMPLETED",
      fillDeadline: 1794514665,
      funder: "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df",
      resolvedAt: 1794341987,
    },
    {
      orderId: "0xc379c1563934f746bbe1d6aa39854840e752611af4991bf68838a4a4a2e18d49",
      createdAt: 1794328667,
      originChainId: "1",
      sender: "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df",
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amountIn: "3000000",
      destChainId: "25363",
      tokenOut: "0x000000000000000000000000d48e565561416de59da1050ed70b8d75e8ef28f9",
      amountOut: "2000000",
      designatedSolver: "0x00000000000000000000000012e9b6c507ed27eae9cc55910b862de26925827b",
      openTx: "0xf64f646cb37c7737274f118b6b11517052ac362d5fcc6768724dac9503615548",
      amountOutFilled: "2000000",
      fillCount: "1",
      amountInReleased: "3000000",
      fillReportCount: "1",
      amountRefunded: "0",
      status: "COMPLETED",
      fillDeadline: 1794501415,
      funder: "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df",
      resolvedAt: 1794328727,
    },
    {
      orderId: "0xb99858136b29c824d3ca8718ec111fd956c6717f881a8a579eee0594f26c32f1",
      createdAt: 1794158711,
      originChainId: "1",
      sender: "0x28963EDb161FeF407E22D62F608f431B498C0D5e",
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amountIn: "20000000000",
      destChainId: "25363",
      tokenOut: "0x000000000000000000000000d48e565561416de59da1050ed70b8d75e8ef28f9",
      amountOut: "19999000000",
      designatedSolver: "0x00000000000000000000000012e9b6c507ed27eae9cc55910b862de26925827b",
      openTx: "0xd93775fcb76881b54a63d49644086212dcbc97d62c2578a236e67623ae1dd14c",
      amountOutFilled: "19999000000",
      fillCount: "1",
      amountInReleased: "20000000000",
      fillReportCount: "1",
      amountRefunded: "0",
      status: "COMPLETED",
      fillDeadline: 1794763470,
      funder: "0x28963EDb161FeF407E22D62F608f431B498C0D5e",
      resolvedAt: 1794158759,
    },
  ],
  total: 18,
  limit: 3,
  offset: 0,
};

/** `GET /orders/Ethereum/{orderId}` for the first order of the list above. */
export const ORDER_API_ORDER = {
  orderId: "0x96200fe4d729350b4b84ad5f840946c82f44e064b6510b34bb7758749f1f4f5a",
  version: 1,
  nonce: "1",
  sender: "0x0000000000000000000000008077c0aa108b77a4c0848471b88f97f4fb8fa4df",
  recipient: "0x0000000000000000000000008077c0aa108b77a4c0848471b88f97f4fb8fa4df",
  originChainId: 1,
  destChainId: 25363,
  tokenIn: "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  tokenOut: "0x000000000000000000000000d48e565561416de59da1050ed70b8d75e8ef28f9",
  amountIn: "3000000",
  amountOut: "2000000",
  designatedSolver: "0x00000000000000000000000012e9b6c507ed27eae9cc55910b862de26925827b",
  createdAt: 1794341939,
  fillDeadline: 1794514665,
  status: "COMPLETED",
  amountOutFilled: "2000000",
  amountInReleased: "3000000",
  amountRefunded: "0",
  funder: "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df",
  openTx: "0x001c17cae0212556278b56782a3f5a39fad32b64689d377e6ac78999bccb719b",
  fillCount: "1",
  fillReportCount: "1",
  resolvedAt: 1794341987,
  fills: [
    {
      filledAt: 1794341958,
      chainId: 25363,
      transactionHash: "0x99c60217d8bedeefa176a9b39694e0233e5be99b55c132b0f6bfabf517e91c53",
      solver: "0x12e9b6c507ed27eae9cc55910b862de26925827b",
      amountInToRelease: "3000000",
      amountOutFilled: "2000000",
    },
  ],
};
