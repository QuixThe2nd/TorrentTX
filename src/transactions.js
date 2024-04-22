import fs from 'fs'
import ethUtil from 'ethereumjs-util'
import Transaction from './transaction.js'

export default class Transactions {
  constructor (clients) {
    if (!fs.existsSync('transactions')) fs.mkdirSync('transactions')

    this.clients = clients
    this.transactions = {}
    this.balances = {}
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
        const transaction = new Transaction(this.clients, { hash: file.replace('.json', '') })
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
    // if (remaining_utxos[hash])
    //     remaining_utxos[hash] += tx.amount;
    // else
    //     remaining_utxos[hash] = tx.amount;
    // for (const i in tx.prev) {
    //     const hash = tx.prev[i];
    //     if (remaining_utxos[hash])
    //         remaining_utxos[hash] -= tx.amount;
    //     else
    //         remaining_utxos[hash] = -tx.amount;
    // }

    if (this.balances[transaction.body.to]) this.balances[transaction.body.to] += transaction.body.amount
    else this.balances[transaction.body.to] = transaction.body.amount

    if (transaction.hash !== transaction.genesisHash) {
      if (this.balances[transaction.body.from]) this.balances[transaction.body.from] -= transaction.body.amount
      else this.balances[transaction.body.from] = -transaction.body.amount
    }
  }

  calculateBalanceState () {
    const supply = Object.values(this.clients.transactions.balances).reduce((a, b) => a + b, 0)
    const usedAddresses = Object.keys(this.clients.transactions.balances).length
    const transactionCount = fs.readdirSync('transactions').length
    const hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.clients.transactions.balances, null, 4))).toString('hex')
    console.log('Supply', supply)
    console.log('Used Addresses', usedAddresses)
    console.log('Transaction Count', transactionCount)
    console.log('Hash', hash)
    const state = `${hash}.${supply}.${usedAddresses}.${transactionCount}`
    return state
  }

  findUnusedUTXOs (address, amount) {
    const UTXOs = []
    const transactions = fs.readdirSync('transactions')
    for (const file of transactions) {
      if (file.substring(0, 1) === '.') continue
      const data = JSON.parse(fs.readFileSync(`transactions/${file}`))
      const { tx, signature, hash } = data
      if (tx.to === address) UTXOs.push({ tx, signature, hash })
    }

    // sort UTXOs by amount, lowest first
    UTXOs.sort((a, b) => a.tx.amount - b.tx.amount)

    // Loop through UTXOs from smallest to largest till you find one bigger than amount
    const selectedUTXOs = []
    for (const UTXO of UTXOs) {
      if (UTXO.tx.amount >= amount) {
        selectedUTXOs.push(UTXO.hash)
        break
      }
    }

    if (selectedUTXOs.length === 0) {
      // Sort UTXOs by amount, largest first
      UTXOs.sort((a, b) => b.tx.amount - a.tx.amount)

      let total = 0
      for (const UTXO of UTXOs) {
        selectedUTXOs.push(UTXO.hash)
        total += UTXO.tx.amount
        if (total >= amount) break
      }
    }

    if (selectedUTXOs.length === 0) throw new Error("Can't find UTXO")

    return selectedUTXOs
  }

  search (clients, { query }) {
    const results = {
      transactions: [],
      balances: {}
    }

    if (query.startsWith('0x')) {
      for (const hash in clients.transactions.transactions) {
        const transaction = clients.transactions.transactions[hash]
        if (transaction.body.from === query || transaction.body.to === query) results.transactions.push(transaction)
      }
      results.balances[query] = clients.transactions.balances[query]
    }

    for (const hash in clients.transactions.transactions) {
      results.transactions = clients.transactions.transactions[hash]
    }
    return results
  }
}
