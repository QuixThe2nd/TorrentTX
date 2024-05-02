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
    let transactionFound = true
    const loadedTransactions = []
    while (transactionFound) {
      transactionFound = false
      const files = fs.readdirSync('transactions')
      for (const file of files) {
        if (file.substring(0, 1) === '.') continue
        if (loadedTransactions.includes(file)) continue
        const transaction = new Transaction(this.glob, { hash: file.replace('.json', '') })
        if (!this.transactions[transaction.hash] && this.addTransaction(transaction)) {
          loadedTransactions.push(file)
          transactionFound = true
        }
      }
      if (!transactionFound) break
    }
  }

  addTransaction (transaction) {
    if (transaction.isValid() && !this.transactions[transaction.hash]) {
      this.transactions[transaction.hash] = transaction
      this.updateBalances(transaction)
      return true
    }
    return false
  }

  updateBalances (transaction) {
    const tx = transaction.body
    const hash = transaction.hash

    if (this.remaining_utxos[hash]) throw new Error('UTXO already set')

    this.remaining_utxos[hash] = tx.amount

    let remaining = tx.amount
    for (const hash of tx.prev) {
      const subtract = Math.min(this.remaining_utxos[hash], tx.amount, remaining)
      remaining -= subtract
      this.remaining_utxos[hash] -= subtract
    }

    if (this.balances[transaction.body.to]) this.balances[transaction.body.to] += transaction.body.amount
    else this.balances[transaction.body.to] = transaction.body.amount

    if (transaction.hash !== this.glob.genesisHash) {
      if (this.balances[transaction.body.from]) this.balances[transaction.body.from] -= transaction.body.amount
      else this.balances[transaction.body.from] = -transaction.body.amount
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
