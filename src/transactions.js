import fs from "fs";
import Transaction from "./transaction.js";

export default class Transactions {
    constructor(clients) {
        this.clients = clients;
        this.transactions = {};
        this.balances = {};

        let transactionFound = true;
        while (transactionFound) {
            transactionFound = false;
            const files = fs.readdirSync('transactions');
            for (const i in files) {
                const transaction = new Transaction(clients, {hash:files[i].replace('.json', '')});
                if (!this.transactions[transaction.hash] && this.addTransaction(transaction)){
                    transactionFound = true;
                }
            }
            if (!transactionFound)
                break;
        }
    }

    addTransaction(transaction) {
        if (transaction.isValid()) {
            this.transactions[transaction.hash] = transaction;
            this.updateBalances(transaction);
            return true;
        }
        return false;
    }

    updateBalances(transaction) {
        // TODO: add this back in
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
}