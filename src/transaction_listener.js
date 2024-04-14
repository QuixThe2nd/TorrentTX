import fs from "fs";
import Transaction from './transaction.js';
// import fetch from 'node-fetch';

export default function transactionListener(clients) {
    const transactions = fs.readFileSync('./infohashes.txt').toString().split('\n');
    let leechingInfohashes = [];
    // fetch('https://ttx-dht.starfiles.co/peers.txt?c=' + Math.random()).then(response => response.text()).then(data => {
    //     for (const i in data.split('\n')) {
    //         const peer = data.split('\n')[i].split(':');
    //         if (!peer[0].match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/))
    //             continue;
    //         if (peer[1] < 1024 || peer[1] > 65535)
    //             continue;
    //         const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), data.split('\n')[i]]);
    //         fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
    //     }
    // });
    // const pullFromDHT = () => {
    //     fetch('https://ttx-dht.starfiles.co/transactions.txt?c=' + Math.random()).then(response => response.text()).then(data => {
    //         const infohashes = data.split('\n');
    //         for (const i in infohashes) {
    //             if (!leechingInfohashes.includes(infohashes[i]) && !transactions.includes(infohashes[i])) {
    //                 new Transaction(clients, {infohash: infohashes[i]});
    //                 leechingInfohashes.push(infohashes[i]);
    //             }
    //         }
    //     });
    //     setTimeout(() => pullFromDHT, 5000);
    // };
    // pullFromDHT();

    let listenPort = 6901;
    const findPortAndBind = () => {
        if (listenPort >= 7000) {
            console.log('Failed to bind to any port in the specified range.');
            return;
        }

        clients.dgram.bind(listenPort);
    };

    clients.dgram.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`Port ${listenPort} is already in use, trying next available port.`);
            listenPort++;
            findPortAndBind();
        } else {
            console.error(`Server error: ${err.code}`);
            clients.dgram.close();
        }
    });

    findPortAndBind();

    clients.dgram.on('listening', () => {
        const address = clients.dgram.address();
        console.info(`Client listening ${address.address}:${address.port}`);

        const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n');
        const peers = fs.readFileSync('./peers.txt').toString().split('\n');

        for (const i in peers) {
            const peer = peers[i].split(':');
            if (!peer[0].match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/))
                continue;
            if (peer[1] < 1024 || peer[1] > 65535)
                continue;
            clients.dgram.send(JSON.stringify({torrents, peers}), peer[1], peer[0], (err) => {
                if (!err)
                    console.verbose(peers[i], 'Sent payload');
                else
                    console.warn(peers[i], err.code, 'Failed to send payload');
            });
        }
    });

    clients.dgram.on('message', (msg, rinfo) => {
        const payload = JSON.parse(msg.toString());
        console.verbose(`${rinfo.address}:${rinfo.port}`, "Received payload");

        // insert sender into peers list
        const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), `${rinfo.address}:${rinfo.port}`]);
        fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));

        if (payload['peers']) {
            const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), ...payload['peers']]);
            fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
        }

        if (payload['torrents']) {
            for (const i in payload['torrents']) {
                if (!leechingInfohashes.includes(payload['torrents'][i]) && !transactions.includes(payload['torrents'][i])) {
                    new Transaction(clients, {infohash: payload['torrents'][i]});
                    leechingInfohashes.push(payload['torrents'][i]);
                }
            }
        }

        if(!payload['pong']) {
            const response = {
                torrents: fs.readFileSync('./infohashes.txt').toString().split('\n'),
                peers: fs.readFileSync('./peers.txt').toString().split('\n'),
                pong: true,
            };

            clients.dgram.send(JSON.stringify(response), rinfo.port, rinfo.address, (err) => {
                if (!err)
                    console.verbose(rinfo.address + ':' + rinfo.port, 'Sent payload');
                else
                    console.warn(rinfo.address + ':' + rinfo.port, err.code, 'Failed to send payload');
            });
        }
    });

    let connections = 0;
    clients.dgram.on('connect', () => {
        console.log('Client connected');
        connections++;
        console.log('Connections:', connections);
    });

    clients.dgram.on('close', () => {
        console.log('Client closed');
        connections--;
        console.log('Connections:', connections);
    });
}