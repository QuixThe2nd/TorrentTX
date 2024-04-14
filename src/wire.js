import { EventEmitter } from 'events'
import bencode from 'bencode'
import { arr2text, concat } from 'uint8-util'
import { type } from 'os'

export default () => {
  	class utMetadata extends EventEmitter {
  	  	constructor(wire) {
  	  	  	super()

  	  	  	this.wire = wire
  	  	}

  	  	onHandshake(infoHash, peerId, extensions) {
	  		console.log(infoHash, peerId, extensions);
  	  	}

  	  	onExtendedHandshake(handshake) {
  	  	  	if (!handshake.m || !handshake.m.torrenttx)
  	  	  	  	return this.emit('warning', new Error('Peer does not support torrenttx'))

  	  	  	this.sendPayload();
  	  	}

  	  	send(dict, trailer) {
  	  	  	let buf = bencode.encode(dict)
  	  	  	if (ArrayBuffer.isView(trailer)) {
  	  	  	  	buf = concat([buf, trailer])
  	  	  	}
  	  	  	this.wire.extended('torrenttx', buf)
  	  	}

		sendPayload(type='ping') {
			const transactions = fs.readFileSync('./infohashes.txt').toString().split('\n');
			const peers = fs.readFileSync('./peers.txt').toString().split('\n');

			const payload = {
				torrents: transactions,
				peers,
				msg_type: type === 'ping' ? 0 : 1
			};

			this.send(payload);
		}

  	  	onMessage(buf) {
  	  	  	let dict
  	  	  	let trailer
  	  	  	try {
  	  	  	  	const str = arr2text(buf)
  	  	  	  	const trailerIndex = str.indexOf('ee') + 2
  	  	  	  	dict = bencode.decode(str.substring(0, trailerIndex))
  	  	  	  	trailer = buf.slice(trailerIndex)
  	  	  	} catch (err) {
  	  	  	  	return
  	  	  	}

			// Save peers
			if (dict.peers) {
				const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), ...dict.peers]);
				fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
			}

			// Save transactions


			if (dict.msg_type === 0)
				this.sendPayload(type='pong')
  	  	}
  	}
  	utMetadata.prototype.name = 'torrenttx'
  	return utMetadata
}