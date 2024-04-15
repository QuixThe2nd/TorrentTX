import fs from 'fs';
import fetch from 'node-fetch';
import ethUtil from 'ethereumjs-util';
import Wire from './wire.js';

export default class Transaction {
    constructor(clients, {from, to, amount, message, hash, infohash, torrentPath, path}) {
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

            if (this.clients.webtorrent.torrents.find(torrent => torrent.infoHash === infohash)) {
                // console.log('Torrent is already downloading');
                return false;
            }

            console.log(infohash, "Received");

            this.leech(infohash);
        } else if (torrentPath) {
            console.info("Bootstrapping transaction from torrent file", torrentPath);

            this.leech(torrentPath);
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


    async leech(torrentId) {
        if (!await this.clients.webtorrent.get(torrentId)) {
            this.clients.webtorrent.add(torrentId, {announce: this.trackers, strategy: 'rarest'}, (torrent) => {
                this.torrent = torrent;
                const clients = this.clients;

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
                    console.error(torrent.infoHash, err);
                });
                torrent.on('download', (bytes) => {
                    console.verbose(torrent.infoHash, 'Downloaded', bytes + ' bytes');
                });
                torrent.on('upload', (bytes) => {
                    console.verbose(torrent.infoHash, 'Uploaded', bytes + ' bytes');
                });
                torrent.on('wire', function (wire, addr) {
                    console.log(torrent.infoHash, 'Connected to torrent peer: ' + addr);
                    wire.clients = clients;
                    wire.use(Wire());
                });
                torrent.on('noPeers', function (announceType) {
                    if (!torrent.done)
                        console.verbose(torrent.infoHash, 'No peers found for', announceType);
                });
                torrent.on('done', () => {
                    console.log(torrent.infoHash, 'Download complete');

                    const files = torrent.files;
                    for (const i in files) {
                        const file = files[i];
                        console.log(torrent.infoHash, 'File:', file.path);

                        this.txContentString =  fs.readFileSync(torrent.path + '/' + file.path).toString();
                        this.content = JSON.parse(this.txContentString);
                        console.log(this.content)
                        this.hash = this.content.hash;
                        this.body = this.content.tx;
                        this.signature = this.content.signature;
                        this.torrent = torrent;

                        this.validateAndSaveTransaction();

                        this.clients.transactions.addTransaction(this);

                        torrent.destroy();
                    };
                });
            });
        }
    }

    async seed() {
        if (!await this.clients.webtorrent.get(this.hash)) {
            this.clients.webtorrent.seed(`transactions/${this.hash}.json`, {announce: this.trackers, strategy: 'rarest'}, (torrent) => {                
                const clients = this.clients;
                this.torrent = torrent;
                console.log(torrent.infoHash, 'Seeding', torrent.files[0].path);

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
                    console.verbose(torrent.infoHash, 'Downloaded', bytes + ' bytes');
                });
                torrent.on('upload', (bytes) => {
                    console.verbose(torrent.infoHash, 'Uploaded', bytes + ' bytes');
                });
                torrent.on('wire', function (wire, addr) {
                    console.log(torrent.infoHash, 'Connected to torrent peer: ' + addr);
                    wire.clients = clients;
                    wire.use(Wire());
                });
                torrent.on('noPeers', function (announceType) {
                    if (!torrent.done)
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
    }

    validateAndSaveTransaction() {
        if (this.isValid()) {
            const prev = this.body.prev;
            for (const i in prev) {
                const hash = prev[i];
                if (!this.clients.transactions.transactions[hash]) {
                    this.clients.transactions.addTransaction(new Transaction(this.clients, {hash}));
                }
            }

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
        // fetch('https://ttx-dht.starfiles.co/' + this.infohash).then(response => response.text()).then(data => console.log("Announced transaction to DHT gateway"));

        const wires = this.clients.webtorrent.torrents.map(torrent => torrent.wires).flat();
        console.log(wires);
    }

    async getTrackers() {;
        const wsResponse = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt');
        const wsTrackers = await wsResponse.text();

        const bestResponse = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt');
        const bestTrackers = await bestResponse.text();

        this.trackers = (wsTrackers + '\n' + bestTrackers).split('\n').filter(Boolean);

        return this.trackers;
    }
}
