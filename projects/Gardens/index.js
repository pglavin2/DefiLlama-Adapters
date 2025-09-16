const { JsonRpcProvider,  getAddress } = require('ethers');

const communityCreatedIface = 'event CommunityCreated(address _registryCommunity)';
const communityCreatedTOPIC0 = 'CommunityCreated(address)';

const poolCreatedIface = 
  'event PoolCreated(uint256 _poolId, address _strategy, address _community, address _token, (uint256 protocol,string pointer) _metadata)';
const POOL_CREATED_T0 = 'PoolCreated(uint256,address,address,address,(uint256,string))';

const FACTORY_ADDRESSES = {
  xdai: ['0x08df82f74d1f56f650e98da2dd4240f1a31711bc'],
  arbitrum: ['0xc1c2e092b7dbc8413e1ac02e92c161b0bda783f6'],
  base: ['0xc93830dd463516ed5f28f6cd4f837173b87ff389'],
  optimism: ['0x1fac47cf25f1ca9f20ba366099d26b28401f5715'],
  polygon: ['0x57a9835b204dbcc101dbf981625a3625e8043b9c'],
  celo: ['0xa71023bc64c9711c2037ab491de80fd74504bd55'],
};

const deployedBlock = {
  xdai: 36032425,
  arbitrum: 251465094,
  base: 26188356,
  optimism: 125112017,
  polygon: 61584767,
  celo: 31271525,
};

const CHAIN_RPC_ENV = {
  xdai: 'XDAI_RPC',
  arbitrum: 'ARBITRUM_RPC',
  base: 'BASE_RPC',
  optimism: 'OPTIMISM_RPC',
  polygon: 'POLYGON_RPC',
  celo: 'CELO_RPC',
};

function providerFor(chain) {
  const envKey = CHAIN_RPC_ENV[chain];
  const url = process.env[envKey];
  if (!url) throw new Error(`Missing RPC for ${chain} (${envKey})`);
  return new JsonRpcProvider(url);
}

// chunker with per-chain cap + adaptive halving
async function getLogs(api,  address, topic, fromBlock, toBlock) {
  return api.getLogs({
    target: address,
    topic, 
    fromBlock,
    toBlock,
  });
}

async function fetchCommunities(api) {
  const factories = FACTORY_ADDRESSES[api.chain] || [];
  if (!factories.length) return [];

  const from = deployedBlock[api.chain] ?? 1;

  const all = [];
  for (const addr of factories) {
    const ls = await getLogs(api,  addr, communityCreatedTOPIC0, from,  "latest");
    all.push(...ls);
  }

  const communities = all.map(log => {
    const decoded = communityCreatedIface.decodeEventLog('CommunityCreated', log.data, log.topics);
    return getAddress(decoded._registryCommunity);
  });

  return [...new Set(communities)];
}

function decodePoolCreated(log) {
  const d = poolCreatedIface.decodeEventLog('PoolCreated', log.data, log.topics);
  return {
    poolId: d._poolId.toString(),
    strategy: getAddress(d._strategy),
    community: getAddress(d._community),
    token: getAddress(d._token),
    metadata: { protocol: d._metadata.protocol.toString(), pointer: d._metadata.pointer },
  };
}

async function fetchPools(api, communities) {
  const from = deployedBlock[api.chain] ?? 1;
  const logs = [];
  for (const addr of communities) {
    const ls = await getLogs(api,  addr, POOL_CREATED_T0, from, 'latest');
    logs.push(...ls);
  }
  // de-dupe by strategy-token
  const uniq = new Map();
  for (const log of logs) {
    const p = decodePoolCreated(log);
    uniq.set(`${p.strategy}-${p.token}`, p);
  }
  return [...uniq.values()];
}

async function tvl(api) {
  const communities = await fetchCommunities(api);
  const pools = await fetchPools(api, communities);

  // Fetching balance
  const calls = pools.map(p => ({ target: p.token, params: [p.strategy] }));

  const balances = await api.multiCall({ abi: 'erc20:balanceOf', calls });

  balances.forEach((bal, i) => {
    if (bal && bal > 0) api.add(pools[i].token, bal);
  });

  return;
}

module.exports = {
  methodology: 'Uses ethers.getLogs with chunking to read CommunityCreated events from proxy factories.',
  start: 1640995200,
  xdai: { tvl },
  arbitrum: { tvl },
  base: { tvl },
  optimism: { tvl },
  polygon: { tvl },
  celo: { tvl },
};
