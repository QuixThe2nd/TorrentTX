import fs from 'fs'
import bencode from 'bencode'
import ethUtil from 'ethereumjs-util'
import Wire from './wire.js'

export default class Transaction {
  constructor (glob, { from, to, amount, message, hash, infohash, torrentPath, path }) {
    this.glob = glob

    if (hash) {
      this.hash = hash
      this.txContentString = fs.readFileSync(`transactions/${hash}.json`).toString()
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
    } else if (from && to && amount) {
      this.body = {
        nonce: Math.random(),
        from,
        to,
        amount: amount / 1,
        message: message ?? '',
        prev: /* isGenesis ? [] : */glob.transactions.findUnusedUTXOs(from, amount)
      }

      this.hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.body))).toString('hex')
      this.signature = glob.wallet.signHash(this.hash)

      this.content = { tx: this.body, signature: this.signature, hash: this.hash }
      this.txContentString = JSON.stringify(this.content, null, 4)

      this.validateAndSaveTransaction()
    }
  }

  isValid () {
    if (this.hash === this.glob.genesisHash) return true
    if (isNaN(this.body.amount)) return false
    if (this.body.amount < 0) return false
    if (!this.glob.transactions.balances[this.body.from] || this.glob.transactions.balances[this.body.from] < this.body.amount) return false
    if (!this.body.prev.length) return false

    for (const hash of this.body.prev) {
      if (!fs.existsSync(`transactions/${hash}.json`)) return false
    }

    // TODO: Make sure prev isn't overspent
    // TODO: Make sure prev is sent to the person who's sending this transaction

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
          alwaysChokeSeeders: false,
          path: 'mempool'
        },
        torrent => {
          this.torrent = torrent
          const glob = this.glob

          console.log(torrent.infoHash, 'Added')

          torrent.on('metadata', () => console.log(torrent.infoHash, 'Metadata received'))
          torrent.on('ready', () => console.log(torrent.infoHash, 'Download ready'))
          torrent.on('warning', err => console.verbose(torrent.infoHash, err.message))
          torrent.on('error', err => console.error(torrent.infoHash, err.message))
          // torrent.on('download', bytes => console.verbose(torrent.infoHash, 'Downloaded', bytes + ' bytes'))
          // torrent.on('upload', bytes => console.verbose(torrent.infoHash, 'Uploaded', bytes + ' bytes'))
          torrent.on('noPeers', (announceType) => torrent.done || console.verbose(torrent.infoHash, 'No peers found for', announceType))
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
              console.log(this.content)
              this.hash = this.content.hash
              this.body = this.content.tx
              this.signature = this.content.signature
              this.torrent = torrent

              this.validateAndSaveTransaction()

              this.glob.transactions.addTransaction(this)

              torrent.destroy()
            }
          })
        }
      )
    }
  }

  async seed () {
    if (!(await this.glob.webtorrent.get(this.hash))) {
      console.log('Seeding', this.hash)
      this.glob.webtorrent.seed(
        `transactions/${this.hash}.json`,
        {
          announce: this.glob.trackers,
          strategy: 'rarest',
          alwaysChokeSeeders: false,
          path: 'mempool'
        },
        torrent => {
          const glob = this.glob
          this.torrent = torrent
          this.infohash = torrent.infoHash

          console.log(torrent.infoHash, 'Seeding', torrent.files[0].path.replace('.json', ''))

          torrent.on('metadata', () => console.log(torrent.infoHash, 'Metadata received'))
          torrent.on('ready', () => console.log(torrent.infoHash, 'Download ready'))
          torrent.on('warning', err => console.verbose(torrent.infoHash, err.message))
          torrent.on('error', err => console.error(torrent.infoHash, err.message))
          // torrent.on('download', bytes => console.verbose(torrent.infoHash, 'Downloaded', bytes + ' bytes'))
          // torrent.on('upload', bytes => console.verbose(torrent.infoHash, 'Uploaded', bytes + ' bytes'))
          torrent.on('noPeers', (announceType) => torrent.done || console.verbose(torrent.infoHash, 'No peers found for', announceType))
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

  validateAndSaveTransaction () {
    if (this.isValid()) {
      const prev = this.body.prev
      for (const hash of prev) {
        if (!this.glob.transactions.transactions[hash]) this.glob.transactions.addTransaction(new Transaction(this.glob, { hash }))
      }

      if (!fs.existsSync(`transactions/${this.hash}.json`)) fs.writeFileSync(`transactions/${this.hash}.json`, this.txContentString)
      this.seed()
    } else console.verbose('Invalid Transaction')
  }

  announce () {
    console.log('Announcing Transaction', this.hash)
    this.glob.webtorrent.torrents.forEach(torrent => {
      if (torrent.wire) {
        console.log('aaaaa11111')
        torrent.wire.extended('torrenttx', bencode.encode(JSON.stringify({ torrents: [torrent.infoHash], msg_type: 0 })))
      } else {
        console.log('aaaaa22222')
      }
    })
  }
}
