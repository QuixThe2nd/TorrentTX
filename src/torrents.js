import WebTorrent from 'webtorrent';
import {initClients} from './clients.js';

export default class Torrents {
    constructor() {
        this.clients = initClients();
        this.trackers = ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce'];
        this.torrentClient = new WebTorrent();

        this.torrentClient.on('error', console.error);
    }

    seedTransaction(hash) {
        const txPath = `transactions/${hash}.json`;

        return new Promise((resolve, reject) => {
            this.torrentClient.seed(txPath, {announce: this.trackers}, (torrent) => {
                console.log('Seeding:', torrent.infoHash);
                resolve(torrent);
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

        if (this.torrentClient.get(infohash) !== null) {
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

                                    fs.unlink(`${mempoolPath}/${file}`, (err) => {
                                        if (err) {
                                            console.error(err);
                                            return;
                                        }
                                        console.log('Transaction deleted from mempool');
                                    });
                                    this.clients.wallet.checkMempool();
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
            const torrent = this.torrentClient.get(hash);
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