import fs from 'fs'
import { EventEmitter } from 'events'
import bencode from 'bencode'
import { arr2text, concat } from 'uint8-util'
import { type } from 'os'

export default (clients) => {
  	class torrentTx extends EventEmitter {
  	  	constructor(wire) {
  	  	  	super()

  	  	  	this.wire = wire
  	  	}

  	  	onHandshake(infoHash, peerId, extensions) {
	  		console.log(infoHash, "New handshake with:", peerId, extensions);
  	  	}

  	  	onExtendedHandshake(handshake) {
			console.log("Extended handshake with:", handshake.m);
  	  	  	if (!handshake.m || !handshake.m.torrenttx)
  	  	  	  	return this.emit('warning', new Error('Peer does not support torrenttx'))

  	  	  	this.sendPayload();
  	  	}

  	  	send(dict) {
  	  	  	let buf = bencode.encode(JSON.stringify(dict))
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
			console.log('Sending payload:', payload);

			this.send(payload);
		}

  	  	onMessage(buf) {
  	  	  	let dict;
  	  	  	try {
  	  	  	  	const str = arr2text(buf);
				console.log(str);
				dict = JSON.parse(str);
  	  	  	} catch (err) {
				console.error('Error decoding message:', err);
  	  	  	  	return;
  	  	  	}

			console.log('Received payload:', dict);

			// Save peers
			if (dict.peers) {
				const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), ...dict.peers]);
				fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
			}

			// Save transactions
			if (dict.torrents) {
				for (const i in dict.torrents) {
					if (!leechingInfohashes.includes(dict.torrents[i]) && !transactions.includes(dict.torrents[i])) {
						new Transaction(clients, {infohash: dict.torrents[i]});
						leechingInfohashes.push(dict.torrents[i]);
					}
				}
			}

			if (dict.msg_type == 0)
				this.sendPayload(type='pong')
  	  	}
  	}
  	torrentTx.prototype.name = 'torrenttx'
  	return torrentTx
}