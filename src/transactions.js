import fs from 'fs'
import ethUtil from 'ethereumjs-util'
import Transaction from './transaction.js'

export default class Transactions {
  constructor (glob) {
    if (!fs.existsSync('transactions')) fs.mkdirSync('transactions')

    this.glob = glob
    this.transactions = {}
    this.balances = {}
    this.remaining_utxos = {}
  }

  loadSavedTransactions () {
    const files = fs.readdirSync('transactions')
    for (const file of files) {
      if (file.substring(0, 1) === '.') continue
      if (this.transactions[file.replace('.json', '')]) continue
      this.glob._ = new Transaction(this.glob, { hash: file.replace('.json', '') })
    }
  }

  updateBalances (transaction) {
    const tx = transaction.body
    const hash = transaction.hash

    if (this.remaining_utxos[hash]) throw new Error('UTXO already set')

    this.remaining_utxos[hash] = tx.amount

    let amount = tx.amount
    if (tx.instructions) {
      for (const instruction of tx.instructions) {
        console.error([], instruction)
        if (instruction.method === 'deposit') amount += instruction.amount
      }
    }

    let remaining = amount
    for (const hash of tx.prev) {
      const subtract = Math.min(this.remaining_utxos[hash], amount, remaining)
      remaining -= subtract
      this.remaining_utxos[hash] -= subtract
    }

    if (tx.instructions) {
      for (const instruction of tx.instructions) {
        if (instruction.method === 'deposit') {
          if (this.balances[instruction.contract]) this.balances[instruction.to] += instruction.amount
          else this.balances[instruction.contract] = instruction.amount
        }
      }
    }

    if (this.balances[tx.to]) this.balances[tx.to] += tx.amount
    else this.balances[tx.to] = tx.amount

    if (transaction.hash !== this.glob.genesisHash) {
      if (this.balances[tx.from]) this.balances[tx.from] -= amount
      else this.balances[tx.from] = -amount
    }

    this.calculateBalanceState()
  }

  calculateBalanceState () {
    const supply = Object.values(this.balances).reduce((a, b) => a + b, 0)
    const usedAddresses = Object.keys(this.balances).length
    const transactionCount = Object.keys(this.transactions).length
    const hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.balances, null, 4))).toString('hex')
    const cumulativeWeight = this.calculateCumulativeWeight()
    const state = `${hash}.${supply}.${cumulativeWeight}.${usedAddresses}.${transactionCount}`
    this.balanceState = state
    return state
  }

  findUnusedUTXOs (address) {
    const utxos = []
    for (const hash in this.remaining_utxos) {
      if (this.transactions[hash].body.to === address && this.remaining_utxos[hash] > 0) utxos.push(hash)
    }
    return utxos
  }

  search (glob, { query }) {
    const results = {
      transactions: [],
      balances: {}
    }

    if (query.startsWith('0x')) {
      for (const hash in this.transactions) {
        const transaction = this.transactions[hash]
        if (transaction.body.from === query || transaction.body.to === query) results.transactions.push(transaction)
      }
      results.balances[query] = this.balances[query]
    }

    for (const hash in this.transactions) {
      results.transactions = this.transactions[hash]
    }
    return results
  }

  calculateCumulativeWeight () {
    let totalWeight = 0
    for (const hash in this.transactions) {
      const prev = this.transactions[hash].body.prev
      const transaction = this.transactions[hash]
      totalWeight += transaction.body.amount
      for (const prevHash of prev) {
        totalWeight += this.transactions[prevHash].body.amount
      }
    }
    this.cumulativeWeight = totalWeight
    return totalWeight
  }
}
