import { CHAINS } from '../shared/config';
import { POPULAR } from '../shared/popular';
import { fetchPairsBatch } from '../shared/data';
for (const p of POPULAR) {
  const pairs = await fetchPairsBatch(CHAINS[p.chain], [p.address]);
  const hit = pairs.find((x) => x.baseToken.address.toLowerCase() === p.address.toLowerCase());
  console.log(p.slug, hit ? `${hit.baseToken.symbol} ${hit.baseToken.name}` : 'NOT FOUND');
}
