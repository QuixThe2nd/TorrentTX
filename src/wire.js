import fs from 'fs'
import { EventEmitter } from 'events'
import bencode from 'bencode'
import { arr2text } from 'uint8-util'
import Transaction from './transaction.js'

export default () => {
	class torrentTx extends EventEmitter {
		constructor(wire) {
			super();
			this.wire = wire;
			this.clients = wire.clients;
		}

		onHandshake(infoHash, peerId, extensions) {
			console.log(infoHash, "New handshake with:", peerId);
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
			const transactions = fs.readFileSync('infohashes.txt').toString().split('\n');
			const peers = fs.readFileSync('peers.txt').toString().split('\n');

			const payload = {
				torrents: transactions,
				peers,
				msg_type: type === 'ping' ? 0 : 1
			};
			console.log('Sending payload');

			this.send(payload);
		}

		onMessage(buf) {
			let dict;
			try {
				let str = arr2text(buf);

				const first = str.indexOf('{');
				const last = str.lastIndexOf('}');

				dict = JSON.parse(str.slice(first, last + 1));
			} catch (err) {
				console.error('Error decoding message:', err);
				return;
			}

			console.log('Received payload');

			for (const key in dict) {
				console.log(key, dict[key].length);
			}

			// Save peers
			if (dict.peers) {
				const uniquePeers = new Set([...fs.readFileSync('peers.txt').toString().split('\n'), ...dict.peers]);
				fs.writeFileSync('peers.txt', Array.from(uniquePeers).join('\n'));
			}

			// Save transactions
			if (dict.torrents) {
				const transactions = fs.readFileSync('infohashes.txt').toString().split('\n');
				for (const i in dict.torrents) {
					console.verbose('Checking:', dict.torrents[i]);
					if (!transactions.includes(dict.torrents[i]))
						new Transaction(this.clients, {infohash: dict.torrents[i]});
				}
			}

			if (dict.msg_type == 0)
				this.sendPayload('pong');
		}
	}
	torrentTx.prototype.name = 'torrenttx';
	return torrentTx;
}