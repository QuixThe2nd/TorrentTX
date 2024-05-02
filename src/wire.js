import fs from 'fs'
import { EventEmitter } from 'events'
import bencode from 'bencode'
import { arr2text } from 'uint8-util'
import Transaction from './transaction.js'

export default () => {
  class torrentTx extends EventEmitter {
    constructor (wire) {
      super()
      this._wire = wire
      this._glob = wire.glob

      this.state = 'N/A'
      this.version = 'L1 Client'
      this.send = this._send
    }

    onHandshake (infoHash, peerId, extensions) {
      console.log(infoHash, 'New handshake with:', peerId)
    }

    onExtendedHandshake (handshake) {
      console.log('Extended handshake with:', Object.keys(handshake.m).join(', '))
      if (!handshake.m || !handshake.m.torrenttx) return this.emit('warning', new Error('Peer does not support torrenttx'))
      console.log('Peer supports torrenttx')
      this.peerUsesTorrentTx = true

      this.sendPayload()
    }

    _send (dict) {
      const buf = bencode.encode(JSON.stringify(dict))
      if (this.peerUsesTorrentTx) this._wire.extended('torrenttx', buf)
    }

    sendPayload (type = 'ping') {
      console.log('Sending payload')

      this._send({
        torrents: fs.readFileSync('infohashes.txt').toString().split('\n'),
        version: this._glob.version,
        state: this._glob.transactions.balanceState,
        msg_type: type === 'ping' ? 0 : 1
      })
    }

    onMessage (buf) {
      let dict
      try {
        const str = arr2text(buf)

        const first = str.indexOf('{')
        const last = str.lastIndexOf('}')

        dict = JSON.parse(str.slice(first, last + 1))
      } catch (err) {
        console.error('Error decoding message:', err)
        return
      }

      console.log('Received payload')

      this.version = dict.version || '0.0.1'
      this.state = dict.state

      // Save transactions
      if (dict.torrents) {
        const transactions = fs.readFileSync('infohashes.txt').toString().split('\n')
        for (const torrent of dict.torrents) {
          if (!transactions.includes(torrent)) {
            console.log('New transaction:', torrent)
            this._glob._ = new Transaction(this._glob, { infohash: torrent })
          }
        }
      }

      if (dict.msg_type === 0) this.sendPayload('pong')
    }
  }
  torrentTx.prototype.name = 'torrenttx'
  return torrentTx
}
