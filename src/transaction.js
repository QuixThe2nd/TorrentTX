import fs from 'fs';
import fetch from 'node-fetch';
import ethUtil from 'ethereumjs-util';

export default class Transaction {
    constructor(clients, {from, to, amount, message, hash}) {
        this.clients = clients;
        this.genesisHash = fs.readFileSync('genesis.txt').toString().trim();

        if (hash) {
            this.hash = hash;
            this.txContentString = fs.readFileSync(`transactions/${hash}.json`).toString();
            this.content = JSON.parse(this.txContentString);
            this.body = this.content.tx;
            this.signature = this.content.signature;

            this.validateAndSaveTransaction();
        } else {
            this.body = {
                nonce: Math.random(),
                from: from,
                to: to,
                amount: amount / 1,
                message: message,
                prev: /*isGenesis ? [] : */clients.wallet.findUnusedUTXOs(from, amount),
            }
        
            this.hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.body))).toString('hex');
            this.signature = clients.wallet.signHash(this.hash);

            this.content = { tx: this.body, signature: this.signature, hash: this.hash }
            this.txContentString = JSON.stringify(this.content, null, 4);

            this.validateAndSaveTransaction();
        }
    }

    isValid() {
        return true;
        if(this.hash === this.genesisHash)
            return true;
        if(!this.clients.transactions.balances[this.body.from] || this.clients.transactions.balances[this.body.from] < tx.amount)
            return false;
        if (this.body['prev'].length == 0)
            return false;
        for (const i in this.body['prev']) {
            if (!fs.existsSync(`transactions/${prev[i]}.json`))
                return false;
        }

        return this.clients.wallet.verifySignature(hash, signature, tx.from);
    }

    validateAndSaveTransaction() {
        if (this.isValid()) {
            console.log("Valid Transaction");

            if (!fs.existsSync(`transactions/${this.content.hash}.json`))
                fs.writeFileSync(`transactions/${this.content.hash}.json`, this.txContentString);

            this.infohash = this.clients.torrents.seedTransaction(this.content.hash);
        }else
            console.log("Invalid Transaction");
    }

    infohash() { // TODO: THIS WONT WORK
        const torrent = this.clients.torrent.torrentClient.get(this.content.hash);
        if (torrent)
            return torrent.infoHash;
        else
            throw new Error("Invalid infohash");
    }

    announce() {
        const peers = fs.readFileSync('./peers.txt').toString().split('\n');
        fetch('https://ttx-dht.starfiles.co/' + this.infohash).then(response => response.text()).then(data => console.log("Announced transaction to DHT gateway"));
        for (const i in peers) {
            console.log('Broadcasting transaction to:', peers[i]);
            const peer = peers[i].split(':');
            if (!peer[0].match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/))
                continue;
            if (peer[1] < 1024 || peer[1] > 65535)
                continue;
            this.clients.dgram.send(JSON.stringify({torrents: [this.infohash]}), peer[1], peer[0], (err) => {
                if (!err)
                    console.log('Sent payload to:', peers[i]);
                else if (err.code === 'ENOTFOUND')
                    console.warn('Failed to send payload to:', peers[i]);
                else if (err.code === 'EHOSTUNREACH')
                    console.warn('Failed to send payload to:', peers[i]);
                else
                    console.warn(err);
            });
        }
    }
}
