import fs from 'fs';
import fetch from 'node-fetch';
import ethUtil from 'ethereumjs-util';

export default class Transaction {
    constructor(clients, {from, to, amount, message, hash, infohash, path}) {
        this.clients = clients;
        this.genesisHash = fs.readFileSync('genesis.txt').toString().trim();
        this.getTrackers();

        if (hash) {
            this.hash = hash;
            this.txContentString = fs.readFileSync(`transactions/${hash}.json`).toString();
            this.content = JSON.parse(this.txContentString);
            this.body = this.content.tx;
            this.signature = this.content.signature;

            this.validateAndSaveTransaction();
        } else if (path) {
            this.txContentString = fs.readFileSync(path).toString();
            this.content = JSON.parse(this.txContentString);
            this.body = this.content.tx;
            this.hash = this.content.hash;
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

            console.log(infohash, "Received");
            const mempoolPath = `mempool/${infohash}`;
            
            clients.webtorrent.add(`magnet:?xt=urn:btih:${infohash}`, {path: mempoolPath, announce: this.trackers, strategy: 'rarest'}, (torrent) => {
                console.log(torrent.infoHash, 'Added');
                torrent.on('metadata', () => {
                    console.log(torrent.infoHash, 'Metadata received');
                });
                torrent.on('ready', () => {
                    console.log(torrent.infoHash, 'Download ready');
                });
                torrent.on('warning', (err) => {
                    console.verbose(torrent.infoHash, err.message);
                });
                torrent.on('error', (err) => {
                    console.warn(torrent.infoHash, "FATAL", err);
                });
                torrent.on('download', (bytes) => {
                    console.verbose(torrent.infoHash, 'Downloaded:', bytes);
                });
                torrent.on('upload', (bytes) => {
                    console.verbose(torrent.infoHash, 'Uploaded:', bytes);
                });
                torrent.on('wire', function (wire, addr) {
                    console.verbose(torrent.infoHash, 'Connected to torrent peer: ' + addr, wire);
                });
                torrent.on('noPeers', function (announceType) {
                    console.verbose(torrent.infoHash, 'No peers found for', announceType);
                });
                torrent.on('done', () => {
                    console.log(torrent.infoHash, 'Download complete');
                    const files = fs.readdirSync(mempoolPath);
                    for (const i in files) {
                        const file = files[i];
                        this.txContentString = fs.readFileSync(`${mempoolPath}/${file}`);
                        this.content = JSON.parse(this.txContentString);
                        this.hash = this.content.hash;
                        this.body = this.content.tx;
                        this.signature = this.content.signature;
                        this.torrent = torrent;

                        this.validateAndSaveTransaction();

                        this.clients.transactions.addTransaction(this);

                        torrent.destroy();
                        if (fs.existsSync(`${mempoolPath}/${file}`))
                            fs.unlinkSync(`${mempoolPath}/${file}`);
                    };
                });
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
        if (this.hash === this.genesisHash)
            return true;
        if (isNaN(this.body.amount))
            return false;
        if (this.body.amount < 0)
            return false;
        if (!this.clients.transactions.balances[this.body.from] || this.clients.transactions.balances[this.body.from] < this.body.amount)
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
        this.clients.webtorrent.seed(`transactions/${this.hash}.json`, {announce: this.trackers, strategy: 'rarest'}, (torrent) => {
            console.log(torrent.infoHash, 'Seeding');

            torrent.on('metadata', () => {
                console.log(torrent.infoHash, 'Metadata received');
            });
            torrent.on('ready', () => {
                console.log(torrent.infoHash, 'Download ready');
            });
            torrent.on('warning', (err) => {
                console.verbose(torrent.infoHash, err.message);
            });
            torrent.on('error', (err) => {
                console.warn(torrent.infoHash, "FATAL", err);
            });
            torrent.on('download', (bytes) => {
                console.verbose(torrent.infoHash, 'Downloaded:', bytes);
            });
            torrent.on('upload', (bytes) => {
                console.verbose(torrent.infoHash, 'Uploaded:', bytes);
            });
            torrent.on('wire', function (wire, addr) {
                console.verbose(torrent.infoHash, 'Connected to torrent peer: ' + addr, wire);
            });
            torrent.on('noPeers', function (announceType) {
                console.verbose(torrent.infoHash, 'No peers found for', announceType);
            });
            
            this.torrent = torrent;
            this.infohash = torrent.infoHash;

            const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n');
            if (!torrents.includes(torrent.infoHash)) {
                torrents.push(torrent.infoHash);
                fs.writeFileSync('./infohashes.txt', torrents.join('\n'));
            }

            torrent.on('error', (err) => console.warn(err));
        });
    }

    validateAndSaveTransaction() {
        if (this.isValid()) {
            if (!fs.existsSync(`transactions/${this.hash}.json`))
                fs.writeFileSync(`transactions/${this.hash}.json`, this.txContentString);
            this.seed();
        }else
            console.verbose("Invalid Transaction");
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
                    console.log(peers[i], 'Sent payload');
                else
                    console.warn(peers[i], err.code, 'Failed to send payload');
            });
        }
    }

    async getTrackers() {
        const wsResponse = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt');
        const wsTrackers = await wsResponse.text();

        const bestResponse = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt');
        const bestTrackers = await bestResponse.text();

        this.trackers = (wsTrackers + '\n' + bestTrackers).split('\n').filter(Boolean);

        return this.trackers;
    }
}
