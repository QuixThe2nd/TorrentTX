import Transaction from './transaction.js'

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findBlock (glob, transactions) {
  console.info('Finding block...')

  const difficulty = glob.difficulty
  const block = {
    transactions,
    prev: glob.prevBlock,
    time: Date.now()
  }
  const startTime = Date.now()
  let i = 0
  while (true) {
    await sleep(1)
    i++
    block.rand = Math.random()
    const signature = glob.wallet.signHash(JSON.stringify(block))
    const first2chars = signature.substring(0, 2 + difficulty)
    if (first2chars === '0x' + '0'.repeat(difficulty)) {
      console.log(`Signature: ${signature}`)
      console.log('Hashrate:', Math.round(i / ((Date.now() - startTime) / 1000)), 'H/s')
      console.log('Checked ', i, ' hashes')
      console.log('Time:', Math.round((Date.now() - startTime) / 1000), 'seconds')
      return { block, signature }
    }

    if (i % 5000 === 0) {
      const hashrate = i / ((Date.now() - startTime) / 1000)
      console.log('Running for', Math.round((Date.now() - startTime) / 1000), 'seconds')
      console.log('Hashrate:', Math.round(hashrate), `H/s (${i} total)`)

      // probability of finding block for each hash
      const p = Math.pow(16, -difficulty)

      // probability of not finding block for each hash
      const q = 1 - p

      // probability of not finding block in 1 second)
      const qi = Math.pow(q, hashrate)

      // probability of finding block in 1 second
      // const pi = 1 - qi

      // On average how many seconds to find a block
      // const blockTime = 1 / pi

      // console.log('Will find block every', blockTime, 'seconds')

      // seconds needed for x% probability of finding block
      // const t10 = Math.log(1 - 0.1) / Math.log(qi)
      // const t25 = Math.log(1 - 0.25) / Math.log(qi)
      const t50 = Math.log(1 - 0.5) / Math.log(qi)
      // const t75 = Math.log(1 - 0.75) / Math.log(qi)
      // const t90 = Math.log(1 - 0.9) / Math.log(qi)
      // const t99 = Math.log(1 - 0.99) / Math.log(qi)

      // console.log('10% chance of block in', Math.round(t10), 'seconds')
      // console.log('25% chance of block in', Math.round(t25), 'seconds')
      console.log('50% chance of block in', Math.round(t50), 'seconds')
      // console.log('75% chance of block in', Math.round(t75), 'seconds')
      // console.log('90% chance of block in', Math.round(t90), 'seconds')
      // console.log('99% chance of block in', Math.round(t99), 'seconds')
    }
  }
}

export default async function Mine (glob) {
  const address = glob.wallet.address

  while (true) {
    const transactions = Object.values(glob.transactions.transactions)
    const sortedTxs = transactions.sort((a, b) => b.references.length - a.references.length) // TODO: Filter out transactions that are already in a block
    const transactionHashes = sortedTxs.map((tx) => tx.hash)
    const { block, signature } = await findBlock(glob, transactionHashes)
    console.log('Found Block: ', signature)
    const signedBlock = {
      from: address,
      to: address,
      amount: 1,
      block: { block, signature }
    }

    new Transaction(glob, signedBlock)

    // console.log('Transaction:', transaction)
  }
}
