import fs from "fs";
import Transaction from "./transaction.js";

export default class Transactions {
    constructor(clients) {
        if(!fs.existsSync('transactions'))
            fs.mkdirSync('transactions');

        this.clients = clients;
        this.transactions = {};
        this.balances = {};
    }

    loadSavedTransactions() {
        let transactionFound = true;
        while (transactionFound) {
            transactionFound = false;
            const files = fs.readdirSync('transactions');
            for (const i in files) {
                const transaction = new Transaction(this.clients, {hash:files[i].replace('.json', '')});
                if (!this.transactions[transaction.hash] && this.addTransaction(transaction)){
                    transactionFound = true;
                }
            }
            if (!transactionFound)
                break;
        }
    };

    addTransaction(transaction) {
        if (transaction.isValid()) {
            this.transactions[transaction.hash] = transaction;
            this.updateBalances(transaction);
            this.revalidateMempool();
            return true;
        }
        return false;
    }
    
    revalidateMempool() {
        const mempool = fs.readdirSync('mempool');
        for (const i in mempool) {
            const infohash = mempool[i];
            const files = fs.readdirSync(`mempool/${infohash}`);
            for (const j in files) {
                const file = files[j];
                const transaction = new Transaction(this.clients, {path: `mempool/${infohash}/${file}`});
                if (transaction && transaction.isValid()) {
                    const torrent = this.clients.webtorrent.torrents.find(torrent => torrent.path === `mempool/${infohash}`);
                    if(torrent)
                        torrent.destroy();
                    fs.unlinkSync(`mempool/${infohash}/${file}`);
                    if (fs.readdirSync(`mempool/${infohash}`).length === 0)
                        fs.rmdirSync(`mempool/${infohash}`);
                }
            }
        }
    }

    updateBalances(transaction) {
        // if (remaining_utxos[hash])
        //     remaining_utxos[hash] += tx.amount;
        // else
        //     remaining_utxos[hash] = tx.amount;
        // for (const i in tx.prev) {
        //     const hash = tx.prev[i];
        //     if (remaining_utxos[hash])
        //         remaining_utxos[hash] -= tx.amount;
        //     else
        //         remaining_utxos[hash] = -tx.amount;
        // }

        if (this.balances[transaction.body.to])
            this.balances[transaction.body.to] += transaction.body.amount;
        else
            this.balances[transaction.body.to] = transaction.body.amount;

        if (transaction.hash !== transaction.genesisHash) {
            if (this.balances[transaction.body.from])
                this.balances[transaction.body.from] -= transaction.body.amount;
            else
                this.balances[transaction.body.from] = -transaction.body.amount;
        }
    }

    calculateBalanceState() {
        const supply = Object.values(clients.transactions.balances).reduce((a, b) => a + b, 0);
        const usedAddresses = Object.keys(clients.transactions.balances).length;
        const transactionCount = fs.readdirSync('transactions').length;
        const hash = ethUtil.sha256(Buffer.from(JSON.stringify(clients.transactions.balances, null, 4))).toString('hex');
        console.log('Supply', supply);
        console.log('Used Addresses', usedAddresses);
        console.log('Transaction Count', transactionCount);
        console.log('Hash', hash);
        const state = `${hash}.${supply}.${usedAddresses}.${transactionCount}`;
        return state;
    }
    
    findUnusedUTXOs(address, amount) {
        const UTXOs = [];
        const transactions = fs.readdirSync('transactions');
        for (const i in transactions) {
            const file = transactions[i];
            const data = JSON.parse(fs.readFileSync(`transactions/${file}`));
            const { tx, signature, hash } = data;
            if (tx.to === address)
                UTXOs.push({tx, signature, hash});
        }

        // sort UTXOs by amount, lowest first
        UTXOs.sort((a, b) => a.tx.amount - b.tx.amount);

        // Loop through UTXOs from smallest to largest till you find one bigger than amount
        const selectedUTXOs = [];
        for (const i in UTXOs) {
            const UTXO = UTXOs[i];
            if (UTXO.tx.amount >= amount){
                selectedUTXOs.push(UTXO.hash);
                break;
            }
        }

        if (selectedUTXOs.length === 0) {
            // Sort UTXOs by amount, largest first
            UTXOs.sort((a, b) => b.tx.amount - a.tx.amount);

            let total = 0;
            for (const i in UTXOs) {
                const UTXO = UTXOs[i];
                selectedUTXOs.push(UTXO.hash);
                total += UTXO.tx.amount;
                if (total >= amount)
                    break;
            }
        }

        if (selectedUTXOs.length === 0)
            throw new Error("Can't find UTXO");

        return selectedUTXOs;
    }

    getTorrents() {
        return 
    }
}