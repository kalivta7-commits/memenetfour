// ---------------------------------------------------------------------------
// parseCoinGeckoId — extract coin ID from a CoinGecko URL
//
// Handles all known URL formats:
//   https://www.coingecko.com/en/coins/bitcoin          → "bitcoin"
//   https://coingecko.com/en/coins/pepe                 → "pepe"
//   https://www.coingecko.com/coins/dogecoin            → "dogecoin"
//   https://www.coingecko.com/en/coins/the-open-network → "the-open-network"
//
// Returns null if the URL is missing, invalid, or doesn't contain a coin ID.
// ---------------------------------------------------------------------------

export function parseCoinGeckoId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;

  try {
    const cleaned = url.trim();

    // Match /coins/<id> anywhere in the path (handles /en/coins/ and /coins/ variants)
    const match = cleaned.match(/\/coins\/([a-zA-Z0-9][a-zA-Z0-9\-_]*)/);
    if (!match) return null;

    const id = match[1].toLowerCase().trim();

    // Sanity: must be a non-empty slug-like string
    if (!id || id.length < 1 || id.length > 100) return null;

    return id;
  } catch {
    return null;
  }
}

/**
 * Parse a DexScreener pair/token address from a DexScreener URL.
 *
 * https://dexscreener.com/solana/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 * → { chain: 'solana', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
 */
export function parseDexScreenerUrl(url: string | null | undefined): {
  chain: string | null;
  address: string | null;
} {
  const EMPTY = { chain: null, address: null };
  if (!url || typeof url !== 'string') return EMPTY;

  try {
    const cleaned = url.trim();
    // /dex/chain/address  or  /chain/address
    const match = cleaned.match(/dexscreener\.com\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return EMPTY;

    const chain   = match[1].toLowerCase();
    const address = match[2];

    if (!chain || !address) return EMPTY;
    return { chain, address };
  } catch {
    return EMPTY;
  }
}
