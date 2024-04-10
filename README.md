# TorrentTX
An experiment aiming to extend the capabilities of the torrent standard.

TorrentTX aims to build on-top of the torrent protocol by adding a new consensus-layer. The idea is, torrents are the perfect store of information. They are immutable, and stay online as long as ONE person cares to keep them online. Torrents allow for bitcoin-style certainty, with infinite scaling.

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

Genesis infohash is hardcoded to all nodes. Nodes then connect to the DHT network and TorrentRX trackers. The node will keep record of all infohashes discovered and how many times seen. Once the first infohash is discovered after genesis, the node will start downloading the contents of the torrent, then move onto the next, in order of how often its been seen. While parsing, the node will be sorting infohashes using "prev" as the reference. Prev is the infohash in-which the money from the transaction came from. This means as we start pulling transactions in a psuedo-random order, we're discovering the direct ancestor to each transaction. In the case of a discrepency, where someone has double-spent, nodes will keep the transaction they received first, creating a hard-fork between good and bad acting peers.

Once heirarchy is figured out, we can then start building additional "modules", like attaching comments, and additional files. This can allow for smart contracts.

Sidenote:
To create inflation/deflation, we can create a difficulty charge for transactions. Basically, force them to find a hash with x leading 0s. We can say, if ur hash has more leading 0s than the average of the last 5 transactions in the branch, you gain tokens, and if its lower, you pay a fee.

## Current State
~~At the time of writing, I have created the mechanism for creating wallets, creating transactions, and broadcasting transactions. To finish the proof of concept, I need the other side. Discovering and validating new transactions need to be written.~~

An initial devnet is live. Existing code is just a proof of concept. `main.js` acts as a node/wallet. Transaction broadcast and discovery is functional, but I haven't been able to get P2P communication working on WAN, only LAN. So, for transaction discovery and broadcasting, we have 2 solutions in place. A UDP layer for clients to directly communicate and transfer blocks and share peers. And, additionally, a TTX tracker hosted at https://ttx-dht.starfiles.co. When creating a transaction, it is broadcasted to all known peers via UDP (if possible), and also sent to the TTX tracker. The TTX tracker is literally just a directory of all known transaction id's, valid and invalid. At the moment, validation to ensure new coins aren't just minted is disabled to allow for easier testing, yes, this means you can just send yourself coins that you don't own. Block's can, will, and have been deleted while in devnet. Please experiment and create an issue with feedback. PR if you like the idea.

### Todo
There is more todo than what has already been done so far. I'll keep adding things as I remember.
- FIX P2P COMMUNICATION - atm, i cant get anything working via WAN, firewall? idk.
- Actual transaction validation, to make sure transactions have funds backing them.
- Leaving node running overnight results in "Possible EventEmitter memory leak detected" error.
- Archival Contracts (read todo in main.js)
- ttx20 coins (anyone can mint, just like erc20)
- Liquid Swaps
- On-chain-bridging - Bridge Bitcoin, Monero, Ethereum, erc20 tokens, and from layer 2s. Swap on-chain for TTX, or receive wXMR, wETH, wBTC, etc.
- Make block explorer that showcases the states of transactions (mempool, unconfirmed, and confirmed).
- Create sync confirmations - Some-sort of a block height measure for TorrentTX, to see who's further ahead of who. This way you can tell if you need more blocks

## Initialisation
```
git clone https://github.com/QuixThe2nd/TorrentTX
cd TorrentTX
yarn
```

## Usage
```
node main.js
```