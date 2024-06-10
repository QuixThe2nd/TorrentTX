import fs from 'fs'
import ethUtil from 'ethereumjs-util'
import Transaction from './transaction.js'
import vm from 'vm'

export default class Transactions {
  constructor (glob) {
    if (!fs.existsSync('transactions')) fs.mkdirSync('transactions')

    this.glob = glob
    this.transactions = {}
    this.balances = {}
    this.remaining_utxos = {}
    this.verifiedTransactions = []
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

    if (this.remaining_utxos[hash]) return
    this.remaining_utxos[hash] = tx.amount

    // Subtract Amount
    let amount = tx.amount
    if (tx.instructions) {
      for (const instruction of tx.instructions) {
        if (instruction.method === 'deposit') {
          if (!instruction.token) amount += instruction.amount
          else this.glob.contractStore[instruction.token][tx.from] -= instruction.amount
        }
      }
    }
    if (!tx.block) {
      const bytes = Buffer.from(transaction.txContentString).length
      const burn = bytes * tx.burn
      amount += burn
    }

    // Subtract from UTXOs
    let remaining = amount
    for (const hash of tx.prev) {
      const subtract = Math.min(this.remaining_utxos[hash], amount, remaining)
      remaining -= subtract
      this.remaining_utxos[hash] -= subtract
    }

    // Smart Contract Execution
    if (tx.instructions) {
      for (const instruction of tx.instructions) {
        if (instruction.method === 'deposit') {
          if (!instruction.token) {
            if (!this.balances[instruction.contract]) this.balances[instruction.contract] = 0
            this.balances[instruction.contract] += instruction.amount
          } else {
            if (!this.glob.contractStore[instruction.token][instruction.contract]) this.glob.contractStore[instruction.token][instruction.contract] = 0
            this.glob.contractStore[instruction.token][instruction.contract] += instruction.amount
          }
        }
        const send = (to, amount, token = false) => {
          if (token) {
            if (!this.glob.contractStore[token][instruction.contract]) console.error('Contract balance too low') // TODO: catch this in isvalid
            this.glob.contractStore[token][instruction.contract] -= amount
            if (!this.glob.contractStore[token][to]) this.glob.contractStore[token][to] = 0
            this.glob.contractStore[token][to] += amount
          } else {
            if (this.balances[instruction.contract] < amount) console.error('Contract balance too low') // TODO: catch this in isvalid
            if (!this.balances[to]) this.balances[to] = 0
            this.balances[to] += amount
            this.balances[instruction.contract] -= amount
          }
        }
        const sendWrapper = (to, amount, token = false) => { // We wrap so the VM can't access the send function directly
          return send(to, amount, token)
        }
        if (!this.glob.contractStore[instruction.contract]) this.glob.contractStore[instruction.contract] = {}

        const mathProxy = new Proxy(Math, {
          get: (target, prop) => prop === 'random' ? 0.5 : target[prop] // Prevent Math.random() from being called
        })

        const context = { // TODO: Flexi TorrentTX's swap feature doesnt work
          instruction: {
            ...instruction,
            from: tx.from
          },
          store: this.glob.contractStore[instruction.contract],
          send: sendWrapper,
          Math: mathProxy,
          contracts: {
            meta: this.glob.contractStore
          }
        }
        vm.createContext(context)
        vm.runInContext(`${this.transactions[instruction.contract].body.contract};contract(instruction)`, context)
      }
    }

    if (!this.balances[tx.to]) this.balances[tx.to] = 0
    this.balances[tx.to] += tx.amount

    if (tx.block) {
      if (!this.balances[tx.from]) this.balances[tx.from] = 0
      this.balances[tx.from] += 10
      this.remaining_utxos[hash] += 10

      const transactions = tx.block.block.transactions
      for (const transaction of transactions) {
        this.verifiedTransactions.push(transaction)
      }
    }

    if (transaction.hash !== this.glob.genesisHash) this.balances[tx.from] -= amount

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
