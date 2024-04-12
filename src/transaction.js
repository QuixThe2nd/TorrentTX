import fs from 'fs';
import fetch from 'node-fetch';
import ethUtil from 'ethereumjs-util';

export default class Transaction {
    constructor(clients, {from, to, amount, message, hash, infohash}) {
        this.clients = clients;
        this.genesisHash = fs.readFileSync('genesis.txt').toString().trim();
        this.trackers = ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce'];

        if (hash) {
            this.hash = hash;
            this.txContentString = fs.readFileSync(`transactions/${hash}.json`).toString();
            this.content = JSON.parse(this.txContentString);
            this.body = this.content.tx;
            this.signature = this.content.signature;

            this.validateAndSaveTransaction();
        } else if (infohash) {
            if (!infohash || infohash.length !== 40 || !/^[0-9A-Fa-f]+$/.test(infohash)) {
                // console.log("Invalid infohash");
                return false;
            }

            if (clients.webtorrent.torrents.find(torrent => torrent.infoHash === infohash || torrent.path === `mempool/${infohash}`)) {
                // console.log('Torrent is already downloading');
                return false;
            }

            console.log("\nReceived transaction:", infohash);
            console.log('Downloading Metadata', infohash)
            const mempoolPath = `mempool/${infohash}`;
            
            clients.webtorrent.add(`magnet:?xt=urn:btih:${infohash}`, {path: mempoolPath, announce: this.trackers}, (torrent) => {
                console.log('Downloading transaction:', torrent.infoHash);
                torrent.on('done', () => {
                    console.log('Download complete:', torrent.infoHash);
                    const files = fs.readdirSync(mempoolPath);
                    for (const i in files) {
                        const file = files[i];
                        this.txContentString = fs.readFileSync(`${mempoolPath}/${file}`);
                        this.content = JSON.parse(this.txContentString);
                        this.body = tx;
                        this.hash = this.content.hash;
                        this.body = this.content.tx;
                        this.signature = this.content.signature;

                        this.validateAndSaveTransaction();

                        this.clients.transactions.addTransaction(this);

                        torrent.destroy();
                        fs.unlinkSync(`${mempoolPath}/${file}`);
                    };
                });
                resolve(torrent);
            });
        } else if (from && to && amount) {
            this.body = {
                nonce: Math.random(),
                from: from,
                to: to,
                amount: amount / 1,
                message: message ?? '',
                prev: /*isGenesis ? [] : */clients.transactions.findUnusedUTXOs(from, amount),
            }
        
            this.hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.body))).toString('hex');
            this.signature = clients.wallet.signHash(this.hash);

            this.content = { tx: this.body, signature: this.signature, hash: this.hash }
            this.txContentString = JSON.stringify(this.content, null, 4);

            this.validateAndSaveTransaction();
        }
    }

    isValid() {
        if(this.hash === this.genesisHash)
            return true;
        if(!this.clients.transactions.balances[this.body.from] || this.clients.transactions.balances[this.body.from] < this.body.amount)
            return false;
        if (this.body['prev'].length == 0)
            return false;
        for (const i in this.body['prev']) {
            const hash = this.body['prev'][i];
            if (!fs.existsSync(`transactions/${hash}.json`))
                return false;
        }

        return this.clients.wallet.verifySignature(this.hash, this.signature, this.body.from);
    }

    seed() {
        return new Promise((resolve, reject) => {
            clients.webtorrent.seed(`transactions/${hash}.json`, {announce: this.trackers}, (torrent) => {
                console.log('Seeding:', torrent.infoHash);
                this.infohash = torrent.infoHash;

                const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n');
                if (!torrents.includes(torrent.infoHash)) {
                    torrents.push(torrent.infoHash);
                    fs.writeFileSync('./infohashes.txt', torrents.join('\n'));
                }

                resolve(torrent);

                torrent.on('error', (err) => reject(err));
            });
        });
    }

    validateAndSaveTransaction() {
        if (this.isValid()) {
            console.log("Valid Transaction");

            if (!fs.existsSync(`transactions/${this.hash}.json`))
                fs.writeFileSync(`transactions/${this.hash}.json`, this.txContentString);
        }else
            console.log("Invalid Transaction");
    }

    infohash() { // TODO: THIS WONT WORK
        const torrent = this.clients.webtorrent.get(this.hash);
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
