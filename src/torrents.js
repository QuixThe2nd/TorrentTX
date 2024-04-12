import fs from 'fs';
import WebTorrent from 'webtorrent';

export default class Torrents {
    constructor(clients) {
        this.clients = clients;
        this.trackers = ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce'];
        this.torrentClient = new WebTorrent();

        // get torrentClient port
        this.torrentClient.on('listening', () => {
            const address = this.torrentClient.address();
            console.log(`Torrent client listening ${address.address}:${address.port}`);
        });

        this.torrentClient.on('error', console.error);
    }

    seedTransaction(hash) {
        const txPath = `transactions/${hash}.json`;

        return new Promise((resolve, reject) => {
            this.torrentClient.seed(txPath, {announce: this.trackers}, (torrent) => {
                console.log('Seeding:', torrent.infoHash);

                const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n');
                if (!torrents.includes(torrent.infoHash)) {
                    torrents.push(torrent.infoHash);
                    fs.writeFileSync('./infohashes.txt', torrents.join('\n'));
                }

                resolve(torrent);

                torrent.on('error', (err) => {
                    reject(err);
                });
                // fs.writeFile(`torrents/${torrent.infoHash}.torrent`, torrent.torrentFile, (err) => {
                //     if (err) {
                //         console.error('Failed to save the torrent file:', err);
                //         reject(err);
                //     }
                //     console.log('Torrent file saved successfully.');
                //     resolve(torrent);
                // });
            });
        });
    }

    saveTransactionToMempool(infohash) {
        // if (fs.existsSync(`torrents/${infohash}.torrent`)) {
        //     // console.log('Torrent already known');
        //     return;
        // }
        
        if (!infohash || infohash.length !== 40 || !/^[0-9A-Fa-f]+$/.test(infohash)) {
            // console.log("Invalid infohash");
            return;
        }

        if (this.torrentClient.torrents.find(torrent => torrent.infoHash === infohash || torrent.path === `mempool/${infohash}`)) {
            // console.log('Torrent is already downloading');
            return;
        }

        console.log("\nReceived transaction:", infohash);
        console.log('Downloading Metadata', infohash)
        const mempoolPath = `mempool/${infohash}`;
        return new Promise((resolve, reject) => {
            this.torrentClient.add(`magnet:?xt=urn:btih:${infohash}`, {path: mempoolPath, announce: this.trackers}, (torrent) => {
                console.log('Downloading transaction:', torrent.infoHash);
                torrent.on('done', () => {
                    console.log('Download complete:', torrent.infoHash);
                    fs.readdir(mempoolPath, (err, files) => {
                        for (const i in files) {
                            const file = files[i];
                            fs.readFile(`${mempoolPath}/${file}`, 'utf8', (err, data) => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                                const {tx, signature, hash} = JSON.parse(data);
                                if (this.clients.wallet.validateTransaction(tx, signature, hash)) {
                                    console.log("Valid Transaction");
                                    fs.writeFileSync(`transactions/${hash}.json`, data);
                                    // fs.writeFileSync(`torrents/${infohash}.torrent`, torrent.torrentFile);
                                    this.clients.wallet.recalculateBalances();

                                    // Replace transaction in mempool with transaction in transactions
                                    this.clients.torrents.torrentClient.torrents.find(torrent => torrent.path === `mempool/${infohash}`).destroy();
                                    this.seedTransaction(hash);

                                    fs.unlink(`${mempoolPath}/${file}`, (err) => {
                                        if (err) {
                                            console.error(err);
                                            return;
                                        }
                                        console.log('Transaction deleted from mempool');
                                    });
                                    this.clients.wallet.checkMempool(this.clients);
                                }
                            });
                        };
                    });
                });
                resolve(torrent);
            });
        });
    }

    getTransactionInfohash(hash) {
        return new Promise((resolve, reject) => {
            const torrent = this.torrentClient.get(hash)
            if (torrent) {
                resolve(torrent.infoHash);
            } else {
                reject(new Error('Torrent not found'));
            }
        });
    }

    getTorrents() {
        return this.torrentClient.torrents;
    }

    clearTorrents() {
        this.torrentClient.torrents.forEach(torrent => torrent.destroy());
    }
}