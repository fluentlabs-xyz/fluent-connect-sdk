import { createPublicClient, http, getAddress, parseAbiItem, formatUnits } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http("https://eth.drpc.org") });
const USER = getAddress("0x8077c0aa108b77a4c0848471b88f97f4fb8fa4df");
const USDNR = getAddress("0xd48e565561416de59da1050ed70b8d75e8ef28f9");
const FAST_PATH = getAddress("0xd925c84b55e4e44a53749ff5f2a5a13f63d128fd");

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

async function main() {
  const latest = await client.getBlockNumber();
  const found: any[] = [];
  for (let i = 0n; i < 12n && found.length < 6; i++) {
    const toBlock = latest - i * 800n;
    const fromBlock = toBlock - 799n;
    try {
      const logs = await client.getLogs({
        address: USDNR, event: TRANSFER, args: { from: USER }, fromBlock, toBlock,
      });
      found.push(...logs);
    } catch { /* window rejected */ }
  }

  console.log(`USDnr transfers out of the wallet in the last ~9600 blocks: ${found.length}`);
  for (const log of found.slice(0, 5)) {
    const a = log.args as any;
    const tx = await client.getTransaction({ hash: log.transactionHash });
    const to = tx.to ? getAddress(tx.to) : null;
    console.log({
      amount: formatUnits(a.value, 6),
      erc20Recipient: a.to,
      txTo: to,
      isFastPathPortal: to === FAST_PATH,
      selector: tx.input.slice(0, 10),
      hash: log.transactionHash,
    });
  }
}
main().catch((e) => { console.error(e.message.split("\n")[0]); process.exit(1); });
