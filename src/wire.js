import fs from 'fs'
import { EventEmitter } from 'events'
import bencode from 'bencode'
import { arr2text } from 'uint8-util'
import Transaction from './transaction.js'

export default () => {
  class torrentTx extends EventEmitter {
    constructor (wire) {
      super()
      this.wire = wire
      this.glob = wire.glob
    }

    onHandshake (infoHash, peerId, extensions) {
      console.log(infoHash, 'New handshake with:', peerId)
    }

    onExtendedHandshake (handshake) {
      console.log('Extended handshake with:', Object.keys(handshake.m).join(', '))
      if (!handshake.m || !handshake.m.torrenttx) return this.emit('warning', new Error('Peer does not support torrenttx'))
      else console.verbose('Peer supports torrenttx')

      this.sendPayload()
    }

    send (dict) {
      const buf = bencode.encode(JSON.stringify(dict))
      this.wire.extended('torrenttx', buf)
    }

    sendPayload (type = 'ping') {
      console.log('Sending payload')

      this.send({
        torrents: fs.readFileSync('infohashes.txt').toString().split('\n'),
        peers: fs.readFileSync('peers.txt').toString().split('\n'),
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

      for (const key in dict) {
        console.log(key, dict[key].length)
      }

      // Save peers
      if (dict.peers) {
        const peers = fs.readFileSync('peers.txt').toString().split('\n')
        for (const peer of dict.peers) {
          if (peer.match(/^[0-9a-fA-F:.[\]]+$/) && !peers.includes(peer)) peers.push(peer)
        }
        fs.writeFileSync('peers.txt', peers.join('\n'))
      }

      // Save transactions
      if (dict.torrents) {
        const transactions = fs.readFileSync('infohashes.txt').toString().split('\n')
        for (const torrent of dict.torrents) {
          console.verbose('Checking:', torrent)
          if (!transactions.includes(torrent)) this.glob._ = new Transaction(this.glob, { infohash: torrent })
        }
      }

      if (dict.msg_type === 0) this.sendPayload('pong')
    }
  }
  torrentTx.prototype.name = 'torrenttx'
  return torrentTx
}
