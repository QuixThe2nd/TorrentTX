import fs from 'fs'
import ethUtil from 'ethereumjs-util'
import Wire from './wire.js'
import pathLib from 'path'
import vm from 'vm'

const currentPath = process.cwd()

export default class Transaction {
  constructor (glob, { from, to, amount, message, contract, instructions, hash, infohash, torrentPath, path, block }) {
    this.glob = glob
    this.isGenesis = false
    this.references = []

    if (hash) {
      this.hash = hash
      this.txContentString = fs.readFileSync(pathLib.join(currentPath, 'transactions', `${hash}.json`)).toString()
      this.content = JSON.parse(this.txContentString)
      this.body = this.content.tx
      this.signature = this.content.signature

      this.validateAndSaveTransaction()
    } else if (path) {
      this.txContentString = fs.readFileSync(path).toString()
      this.content = JSON.parse(this.txContentString)
      this.body = this.content.tx
      this.hash = this.content.hash
      this.signature = this.content.signature

      this.validateAndSaveTransaction()
    } else if (infohash) {
      if (!infohash || infohash.length !== 40 || !/^[0-9A-Fa-f]+$/.test(infohash)) return false
      if (this.glob.webtorrent.torrents.find(torrent => torrent.infoHash === infohash)) return false

      console.log(infohash, 'Received')

      this.leech(infohash)
    } else if (torrentPath) {
      console.info('Bootstrapping transaction from torrent file', torrentPath)

      this.leech(torrentPath)
    } else if (typeof from !== 'undefined' && typeof to !== 'undefined' && typeof amount !== 'undefined') {
      // this.isGenesis = true
      const unusedUTXOs = this.glob.transactions.findUnusedUTXOs(from)

      const prev = []
      let remaining = amount
      if (instructions) {
        for (const instruction of instructions) {
          if (instruction.method === 'deposit') remaining += instruction.amount
        }
      }

      const origRemaining = remaining
      for (const hash of unusedUTXOs) {
        if (this.glob.transactions.remaining_utxos[hash] >= origRemaining) prev.length = 0
        remaining -= this.glob.transactions.remaining_utxos[hash]

        prev.push(hash)

        if (remaining <= 0) break
      }

      if (remaining > 0 && !this.isGenesis) throw new Error('Not enough UTXOs')

      this.body = {
        nonce: Math.random(),
        from,
        to,
        amount: amount / 1,
        message: message ?? '',
        prev: this.isGenesis ? [] : prev,
        ref: Object.keys(this.glob.transactions.transactions).sort(() => 0.5 - Math.random()).slice(0, 8),
        burn: 0.001
      }

      if (contract) this.body.contract = contract
      if (instructions) this.body.instructions = instructions
      if (block) this.body.block = block

      this.hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.body))).toString('hex')
      this.signature = this.glob.wallet.signHash(this.hash)

      this.content = { tx: this.body, signature: this.signature, hash: this.hash }
      this.txContentString = JSON.stringify(this.content, null, 4)

      this.validateAndSaveTransaction(true)
    }
  }

  handleInvalid (reason) {
    console.error(reason)
    return false
  }

  isValid () {
    if (this.isGenesis) return true
    if (this.hash === this.glob.genesisHash) return true
    if (!this.body) return this.handleInvalid('No body')
    if (isNaN(this.body.amount)) return this.handleInvalid('Amount is not a number')
    if (this.body.amount < 0) return this.handleInvalid('Amount is negative')
    if (!ethUtil.isValidAddress(this.body.to)) return this.handleInvalid('Invalid to address')
    // if (this.body.ref.length < 8) return this.handleInvalid('Not enough references')
    // if any of the references are not valid, return false
    if (this.body.ref && this.body.ref.some(hash => !this.glob.transactions.transactions[hash])) return this.handleInvalid('Invalid reference')
    if (this.body.block) {
      console.log('Block:', this.body.block)
      const firstChars = this.body.block.signature.slice(0, 2 + this.glob.difficulty)
      if (firstChars !== '0x' + '0'.repeat(this.glob.difficulty)) return this.handleInvalid('Block does not meet difficulty requirements')
      if (!this.glob.wallet.verifySignature(JSON.stringify(this.body.block.block), this.body.block.signature, this.body.from)) return this.handleInvalid('Invalid block signature')
      if (this.glob.prevBlock !== this.body.block.block.prev) return this.handleInvalid('Invalid previous block')
      for (const transaction of this.body.block.block.transactions) {
        if (!this.glob.transactions.transactions[transaction]) return this.handleInvalid('Invalid transaction in block')
        if (this.glob.transactions.verifiedTransactions.includes(transaction)) return this.handleInvalid('Transaction already in block')
      }
      // TODO: Validate block time greater than last block time
    } else {
      if (!this.body.prev.length) return this.handleInvalid('No previous transactions')
      if (!this.body.burn || this.body.burn < 0.001) return this.handleInvalid('Burn is too low')
    }

    let amount = this.body.amount
    if (this.body.instructions) {
      for (const instruction of this.body.instructions) {
        if (!instruction.contract) return this.handleInvalid('Contract not set')
        if (!this.glob.transactions.transactions[instruction.contract]) return this.handleInvalid('Contract not found')
        if (instruction.to && !ethUtil.isValidAddress(instruction.to)) return this.handleInvalid('Invalid to address in instruction')
        if (!/^[0-9A-Fa-f]{64}$/.test(instruction.contract)) return this.handleInvalid('Invalid contract hash')
        if (instruction.method === 'deposit') amount += instruction.amount
      }
    }

    let remaining = amount
    for (const hash of this.body.prev) {
      if (!this.glob.transactions.remaining_utxos[hash]) return this.handleInvalid('UTXO not found')
      if (!this.glob.transactions.transactions[hash]) return this.handleInvalid('Transaction not found')
      if (this.glob.transactions.transactions[hash].body.to !== this.body.from) return this.handleInvalid('Invalid previous transaction')
      remaining -= this.glob.transactions.remaining_utxos[hash]
    }

    if (!this.body.block) {
      const bytes = Buffer.from(this.txContentString).length
      const burn = bytes * this.body.burn
      amount += burn
    }

    if (amount > this.glob.transactions.balances[this.body.from]) return this.handleInvalid('Insufficient funds')

    // if (remaining > 0) return this.handleInvalid('Insufficient previous transaction funds')
    if (remaining > 0) {
      console.log('Conflict due to double spending detected:')
      console.log('Transaction attempted: ', this.hash)
      console.log('Conflicting transactions (Possible Fork): ', this.body.prev.filter(hash => this.glob.transactions.remaining_utxos[hash] < remaining).join(', '))
      return this.handleInvalid('Insufficient previous transaction funds') // This error happens in the case of double spending - TODO: Use the reference consensus mechanism to decide which transaction is to be accepted
    }
    if ((!this.glob.transactions.balances[this.body.from] || this.glob.transactions.balances[this.body.from] < this.body.amount) && !this.body.block) return this.handleInvalid('Insufficient funds - if this error is thrown, something went real bad and should be investigated')

    return this.glob.wallet.verifySignature(this.hash, this.signature, this.body.from)
  }

  async leech (torrentId) {
    if (!(await this.glob.webtorrent.get(torrentId))) {
      console.log('Adding Torrent', torrentId)
      this.glob.webtorrent.add(
        torrentId,
        {
          announce: this.glob.trackers,
          strategy: 'rarest',
          // alwaysChokeSeeders: false,
          path: 'mempool'
        },
        torrent => {
          this.torrent = torrent
          const glob = this.glob

          console.log(torrent.infoHash, 'Added')

          torrent.on('metadata', () => console.log(torrent.infoHash, 'Metadata received'))
          torrent.on('ready', () => console.log(torrent.infoHash, 'Download ready'))
          // torrent.on('warning', err => console.verbose(torrent.infoHash, err.message))
          torrent.on('error', err => console.error(torrent.infoHash, err.message))
          // torrent.on('download', bytes => console.verbose(torrent.infoHash, 'Downloaded', bytes + ' bytes'))
          // torrent.on('upload', bytes => console.verbose(torrent.infoHash, 'Uploaded', bytes + ' bytes'))
          // torrent.on('noPeers', (announceType) => torrent.done || console.verbose(torrent.infoHash, 'No peers found for', announceType))
          torrent.on('wire', (wire, addr) => {
            console.log(torrent.infoHash, 'Connected to torrent peer: ' + addr)

            wire.glob = glob
            wire.use(Wire())
          })
          torrent.on('done', () => {
            console.log(torrent.infoHash, 'Download complete')

            const files = torrent.files
            for (const file of files) {
              console.log(torrent.infoHash, 'File:', file.path)

              this.txContentString = fs.readFileSync(torrent.path + '/' + file.path).toString()
              this.content = JSON.parse(this.txContentString)

              this.hash = this.content.hash
              this.body = this.content.tx
              this.signature = this.content.signature
              this.torrent = torrent

              this.validateAndSaveTransaction()

              torrent.destroy()
            }
          })
        }
      )
    }
  }

  async seed (announce = false) {
    if (!(await this.glob.webtorrent.get(this.hash))) {
      console.log('Seeding', this.hash)
      this.glob.webtorrent.seed(
        `transactions/${this.hash}.json`,
        {
          announce: this.glob.trackers,
          strategy: 'rarest',
          // alwaysChokeSeeders: false,
          path: 'mempool'
        },
        torrent => {
          const glob = this.glob
          this.torrent = torrent
          this.infohash = torrent.infoHash
          if (announce) this.announce()

          if (this.isGenesis) {
            fs.writeFileSync('infohashes.txt', torrent.infoHash)
            fs.rmSync('mempool', { recursive: true })
            fs.mkdirSync('mempool')
            fs.rmSync('proofs', { recursive: true })
            fs.mkdirSync('proofs')
            fs.writeFileSync(`proofs/${this.hash}.torrent`, torrent.torrentFile)
            this.glob.webtorrent.seed(Buffer.from(Math.random() + Math.random() + Math.random() + Math.random() + ''), {}, torrent => fs.writeFileSync('proofs/meetingPoint.torrent', torrent.torrentFile))
          }

          if (torrent.files[0]) console.log(torrent.infoHash, 'Seeding', torrent.files[0].path.replace('.json', ''))

          torrent.on('metadata', () => console.log(torrent.infoHash, 'Metadata received'))
          torrent.on('ready', () => console.log(torrent.infoHash, 'Download ready'))
          // torrent.on('warning', err => console.verbose(torrent.infoHash, err.message))
          torrent.on('error', err => console.error(torrent.infoHash, err.message))
          // torrent.on('download', bytes => console.verbose(torrent.infoHash, 'Downloaded', bytes + ' bytes'))
          // torrent.on('upload', bytes => console.verbose(torrent.infoHash, 'Uploaded', bytes + ' bytes'))
          // torrent.on('noPeers', (announceType) => torrent.done || console.verbose(torrent.infoHash, 'No peers found for', announceType))
          torrent.on('wire', (wire, addr) => {
            console.log(torrent.infoHash, 'Connected to torrent peer: ' + addr)

            wire.glob = glob
            wire.use(Wire())
          })

          const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n')
          if (!torrents.includes(torrent.infoHash)) {
            torrents.push(torrent.infoHash)
            fs.writeFileSync('./infohashes.txt', torrents.join('\n'))
          }
        }
      )
    }
  }

  validateAndSaveTransaction (announce = false) {
    // const prev = this.body.prev
    if (this.isValid()) {
      if (this.glob.transactions.transactions[this.hash]) return console.verbose('Transaction already exists')
      if (this.isGenesis) {
        this.glob.webtorrent.torrents.forEach(torrent => torrent.destroy())
        this.transactions = {}
        fs.rmSync('transactions', { recursive: true })
        fs.mkdirSync('transactions')
        fs.writeFileSync('genesis.txt', this.hash)
        this.glob.genesisHash = this.hash
      }
      if (!fs.existsSync(`transactions/${this.hash}.json`)) fs.writeFileSync(`transactions/${this.hash}.json`, this.txContentString)
      if (this.body.ref) {
        for (const hash of this.body.ref) {
          this.glob.transactions.transactions[hash].references.push(this)
        }
      }

      if (this.body.contract) {
        const context = {}
        vm.createContext(context)
        vm.runInContext(`${this.body.contract};metadata=typeof meta === 'undefined' ? false : meta;`, context)
        if (context.metadata) this.glob.contractMeta[this.hash] = context.metadata
      }

      if (this.body.block) this.glob.prevBlock = this.hash
      this.glob.transactions.transactions[this.hash] = this
      this.glob.transactions.updateBalances(this)
      this.glob.transactions.loadSavedTransactions()
      this.seed(announce)
    } else {
      // for (const hash of prev) {
      //   if (!this.glob.transactions.transactions[hash]) new Transaction(this.glob, { hash })
      // }
      console.verbose('Invalid Transaction')
      return false
    }
    return true
  }

  announce () {
    console.log('Announcing Transaction', this.hash)
    this.glob.webtorrent.torrents.forEach(torrent => {
      torrent.wires.forEach(wire => {
        console.log('Announcing to', wire.peerId, 'in', torrent.infoHash)
        if (wire.torrenttx) wire.torrenttx.send({ torrents: [this.infohash], msg_type: 1 })
      })
    })
  }
}
