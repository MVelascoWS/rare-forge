/** Sepolia Etherscan links (FRONTEND_SPEC: link tx hashes / addresses). */
const BASE = "https://sepolia.etherscan.io";

export const txUrl = (hash: string) => `${BASE}/tx/${hash}`;
export const addressUrl = (addr: string) => `${BASE}/address/${addr}`;
export const nftUrl = (contract: string, tokenId: string) =>
  `${BASE}/nft/${contract}/${tokenId}`;

/** Turn an ipfs:// ref into an HTTP gateway URL for <img> display. */
export function ipfsToHttp(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${ref.slice("ipfs://".length)}`;
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  return null;
}
