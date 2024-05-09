# TorrentTX - The world's first Bittorrent Layer 2

An experiment aiming to extend the capabilities of the Bittorrent protocol.

TorrentTX aims to build on-top of the Bittorrent protocol by adding a new consensus-layer. The idea is, torrents are the perfect store of information. They are immutable, and stay online as long as ONE person cares to keep them online. Torrents allow for bitcoin-style certainty, with infinite scaling.

Like my work? Please considering following me or starring this repo ❤️

[![Follow on GitHub](https://img.shields.io/badge/Follow-%40QuixThe2nd-blue?style=social&logo=GitHub)](https://github.com/QuixThe2nd)

## The idea
TLDR: What if the blockchain IS the mempool?

So, what are the main issues with bitcoin?
Scaling for one. Blocksize and blocktime are hardcoded. Essentially, bitcoin is like a single bare-metal server. It can't scale-up to handle more transactions or to lower latency. Torrents however, can. New torrents can be and are created at any rate. There is no artificial cap on how many can be created or how often. As long as someone can host it (seeders), and someone can run a directory (trackers), it can scale.
Mining is another big issue. One argument is carbon emissions, but everyone's heard that one. It's also expensive, and redundant. As a developer, who develops non-blockchain things, one of my main priorities is to keep my code efficient. But we need mining, right? Well, mining is great for proving someone has put effort into assembling the block. And it's crucial that we mine, because it creates an agreed upon hierarchy of transactions, sorted by time. But why do we need blocks in the first place? Blocks are the only thing that really need external proof. Mining ensures the ledger is agreed upon. But what if transactions simply linked directly to other transactions?
FEES...

So, here's the idea.
I create a genesis transaction:
```
{
  "tokens":1000000000,
  "to":hash([PUBLIC_KEY])
  "key":[PUBLIC_KEY],
  "time":[timestamp],
  "prev":null,
  "signature":[SIGNATURE]
}
```
I put it in a file called `tx.json`, and put that file in a folder called `tx`. I then create a torrent for the folder.
I can then broadcast the infohash to bittorent trackers made for the TorrentTX protocol specifically. They keep a record of all blocks. Anyone can create a tracker. The network will have it's own DHT network for distributing blocks too.

For a transaction to be valid, 0 confirmations are required. There are 2 requirements:
- All transactions up the tree are valid too
- There are no conflicting transactions already known by the node.

If some transactions up the tree have 0 seeders, the transaction must fail. As the person holding the money, it is YOUR obligation to keep previous transactions up the tree alive. What this means is, if there's many branches, the further up the tree you go, the more people will be seeding it. This means that as time goes on, the strength of each individual transaction will increase, as long as more people up the tree, in any branch diverging from the original transaction keep transacting.

The person I sent it to can now send lesser or equal amounts to others by creating similar transactions. The heirarchy of transactions is determined by peers using an algorithm similar to this:

Genesis infohash is hardcoded to all nodes. Nodes then connect to the DHT network and TorrentTX trackers. The node will keep record of all infohashes discovered and how many times seen. Once the first infohash is discovered after genesis, the node will start downloading the contents of the torrent, then move onto the next, in order of how often its been seen. While parsing, the node will be sorting infohashes using "prev" as the reference. Prev is the infohash in-which the money from the transaction came from. This means as we start pulling transactions in a psuedo-random order, we're discovering the direct ancestor to each transaction. In the case of a discrepency, where someone has double-spent, nodes will keep the transaction they received first, creating a hard-fork between good and bad acting peers.

Once heirarchy is figured out, we can then start building additional "modules", like attaching comments, and additional files. This can allow for smart contracts.

Sidenote:
To create inflation/deflation, we can create a difficulty charge for transactions. Basically, force them to find a hash with x leading 0s. We can say, if ur hash has more leading 0s than the average of the last 5 transactions in the branch, you gain tokens, and if its lower, you pay a fee.

## Progress
~~At the time of writing, I have created the mechanism for creating wallets, creating transactions, and broadcasting transactions. To finish the proof of concept, I need the other side. Discovering and validating new transactions need to be written.~~

~~An initial devnet is live. Existing code is just a proof of concept. `main.js` acts as a node/wallet. Transaction broadcast and discovery is functional, but I haven't been able to get P2P communication working on WAN, only LAN. So, for transaction discovery and broadcasting, we have 2 solutions in place. A UDP layer for clients to directly communicate and transfer blocks and share peers. And, additionally, a TTX tracker hosted at https://ttx-dht.starfiles.co. When creating a transaction, it is broadcasted to all known peers via UDP (if possible), and also sent to the TTX tracker. The TTX tracker is literally just a directory of all known transaction id's, valid and invalid. At the moment, validation to ensure new coins aren't just minted is disabled to allow for easier testing, yes, this means you can just send yourself coins that you don't own. Block's can, will, and have been deleted while in devnet. Please experiment and create an issue with feedback. PR if you like the idea.~~

~~P2P communication via UDP is live. Transactions received from the TTX-DHT are treated identically to transactions received via payload transfer P2P using UDP. This means, once there are enough nodes, the Starfiles TTX-DHT can be shut down, as there's no need. By enough nodes, I mean, enough to be confident that there is always at least one other person online. Validation now exists. The validation catches most simple exploits. Though it needs thorough testing.~~

~~TorrentTX is now fully built on the Bittorrent protocol. It is a "Bittorrent Layer 2". All communication is done folowing the Bittorrent spec. Essentially, the TorrentTX protocol "hijacks" the standard Bittorrent handshake. If the other client is a standard Bittorrent node, they can still leech/seed to eachother with no issues. But by specifying TorrentTX as an extension during the Bittorrent handshake, if both nodes specify that they're using TorrentTX, they can start communication directly with eachother. This communication is done via the Bittorrent protocol, following the Bittorrent protocol's specs. This means you no longer need to port forward. As for initial peer discovery, I've solved that. You can now export "proofs" by typing `p` in your node. A proof is just a torrent file for a transaction. This proof, allows you to issue a transaction on a node with 0 peers, and export that proof. Meaning you can send someone TTX via Email. I'm not joking. Just create a transaction, print a receipt (proof), and send. What this means, is we can include the genesis torrent file in the source code. When a node runs, on startup, it checks the proof dir for any torrents and starts downloading/seeding them. Using PeX, Bittorrent Trackers, DHT, and all the other fun things native to the Bittorrent protocol, we can start discovering TorrentTX clients, with nothing but a `.torrent` file and this piece of code. With no extra port forwarding or networking required, JUST the bittorrent protocol, so UDP/UTP/TCP, and now wrtc with the WebTorrent library. TTX trackers are no-longer required, they're actually commented by default now. As for next steps, we need to improve transactions discoverability. From there, consensus. It's worth noting, currently all torrents are stored on each node. Eventually when the blockchain becomes large, clients can be modified to just store what's needed.~~

~~Now with GUI.~~

~~Transaction braodcasting is working, things are stable. Clients now send version numbers to eachother. Transaction discoverability is pretty decent now. The next steps are consensus. Essentially, I know what my client thinks is real. But if other clients disagree, I have no way of knowing. This means there could be a hard-fork and I have absolutely no idea. To solve this, we need some sort of block-height measure for nodes, so nodes can compare their states with eachother to confirm whether or not they're in sync with the network. I plan on doing this using cumulative weights, to give clients a rough idea of whether or not they're in sync, and if not, who's furthest ahead. From there, we need some sort of state identifier because 2 nodes may have the same cumulative weight, but they may be running different forks still. I need to research how this can be done. Essentially, we need something like a merkle-tree, that works for DAGs.~~

~~Smart contract support is currently in development. You can deploy a smart contract on chain. Execution of smart contracts is currently not live on-chain. A local implementation is finished. The next steps to move this local implementation to an on-chain implementation are; creating a safe js sandbox, ability to create a transaction that can interact with the smart contract and a global data availability layer. To experiment with building your own smart contract, you can check `src/vm.ts`. To execute, run `ts-node-esm src/vm.ts`. Next steps are explained in the comments of the file.~~

Fees have been temporarily added in the form of burns to resolve spam. Currently the burn rate is set to 0.001, meaning for each byte you submit to the network, you pay 0.001 TTX in fees. This is a temporary measure. My plan for a long term solution is the following. The TorrentTX network will be fee-less. "Layer 2"s can be built on the network with their own spec, that nodes can opt-in to. I put "layer 2" in quotes because they technically aren't a layer 2, I'm just yet to come up with a good term. Each layer 2 has it's own spec as to what criteria a transaction must meet before being accepted. This means that the core TorrentTX layer will act as a base for other layers. For example, a PoW or PoS layer can be built on-top of TorrentTX, using TorrentTX as a standard to allow for cross-layer-2 communication. Because TorrentTX is built in Javascript, the possibilities for how these layers can operate, are endless. A layer may decide to use blocks, while another might stay true to the blockless nature of TorrentTX. I guess you could call this an omni-network, where all chains use the same core fundamentals, but using different mechanism, such as blocks or no blocks, dags or chains, work or stake, etc. So, a real world example. Let's say there is a bitcoin-style PoW layer using blocks, and an ethereum-style PoS layer using blocks. These chains can either use their own tokens, or TTX. Now if you were to hold TTX on the PoW chain, you can bridge it to the PoS chain. Nodes that have opted-in to using both chains, will see what you've done, but a node that's only opted into the PoW chain will just see you bridging assets out, and will ignore those funds after that.

### Versioning
While still in development, TorrentTX uses a modified version of Semver. Version numbers are incrememnted by 0.0.1 for validation changes where 2 versions will treat a transaction differently. Version numbers are incremented by 0.1 whenever a breaking change is pushed. The reason 0.0.1 is only for validation changes is because 2 nodes that use different validation mechanisms can still communicate, even if they can't form a consensus. Eventually when we're out of beta and validation changes won't be a frequent occurance, the versioning will be standardised.

### Rough Plan
There is more todo than what has already been done so far. I'll keep adding things as I remember.
- Route things through Tor by default
- Ethereum/Metamask compatible RPCs
- Archival Contracts (read todo in main.js)
- ttx20 coins (anyone can mint, just like erc20)
- Liquid Swaps
- On-chain-bridging - Bridge Bitcoin, Monero, Ethereum, erc20 tokens, and from layer 2s. Swap on-chain for TTX, or receive wXMR, wETH, wBTC, etc.
- Make block explorer that showcases the states of transactions (mempool, unconfirmed, and confirmed).
- Create sync confirmations - Some-sort of a block height measure for TorrentTX, to see who's further ahead of who. This way you can tell if you need more blocks
- Do some sort of merkle-tree proof for validating you aren't on a different fork compared to other nodes.
- Keep poking holes and adding checks to make it harder to lie
- Make node more stable and add more QoL features and stuff
- Start building system to handle modules, so new features can be added on by anyone, and nodes can opt in on "mining" each type of module individually
- Build native liquidity pools and liquid swaps that remove the need for DEXes
- Build an EVM module using a sandboxed javascript environemnt for smart contracts
- Create framework for people to publish global javascript functions that others can reference in their smart contract
- Eventually we need unit tests

Cross chain bridge:
Through this paragraph, I will say "ethereum" a lot. When I say ethereum, that's just an example.
The way I think this should work is, nodes will be able to mine bridging blocks. A bridging block is essentially a block that exists on both the ethereum and the TorrentTX blockchain at the same time. Essentially, the bridging blocks will be their own proof of work blockchain. If you find a block first, you then publish it to both the ethereum and the torrenttx blockchains and attach a list of all known balances. If someone disagrees, they can keep mining and find another block that disagrees with you, with the standard TTX consensus mechanism applying to PoW, with miner nodes deciding which block to mine future blocks from. The transaction on the ethereum blockchain also contains a list of requests on the TTX chain to bridge assets over to Eth. This will mean TTX is in a constant mempool states, with finality happening whenever someone decides to bridge an asset out. The reward from mining a bridging block is a 1% fee on bridged assets. Assuming everyone is acting in good faith, a bridging block will be produced whenever someone finds one, and enough assets are pending to be bridged off chain to make the ethereum gas fees worth it. Because of this, if we were to write a smart contract on ethereum that just scans for bridging blocks, and assumes everything is accurate, as long as theres no conflicting information, then everything IS accurate. So then the issue is, what if someone is lying. If a bridging block is mined, payouts wont occur instantly. Instead, the block must be undisputed for 24 hours before ethereum withdrawals happen. This means if there are ANY good faith actors, a bad block wont pass because they'll be disputed. Now, this raises the issue of people raising fake disputes.

## Initialisation
```
git clone https://github.com/QuixThe2nd/TorrentTX
cd TorrentTX
yarn
```

## Usage
```
yarn start
```

## Shortcuts
Reset client and start over (first run `d` in node):
```
cd .. && rm -rf TorrentTX && git clone https://github.com/QuixThe2nd/TorrentTX && cd TorrentTX && yarn && clear && yarn start
```
