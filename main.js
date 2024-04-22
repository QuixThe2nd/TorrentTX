import fs from 'fs'
import readline from 'readline'
import { initClients } from './src/clients.js'
import Wallet from './src/wallet.js'
import Transaction from './src/transaction.js'
import Transactions from './src/transactions.js'
import WebTorrent from 'webtorrent'
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import QRCode from 'qrcode'
// import Mine from './src/mine.js'

const currentDir = path.dirname(new URL(import.meta.url).pathname)

if (!fs.existsSync('peers.txt')) fs.writeFileSync('peers.txt', '')
if (!fs.existsSync('infohashes.txt')) fs.writeFileSync('infohashes.txt', '')

const base64encode = str => Buffer.from(str).toString('base64')

const clients = initClients()

function createWindow () {
  clients.browserWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: `${currentDir}/ui/preload.js` }
  })

  clients.browserWindow.loadFile('ui/index.html')
}

(async () => {
  // Open App
  await app.whenReady()
  createWindow()

  // Logging
  console.fallback = console.error
  console.verbose = console.log
  for (const type of ['info', 'log', 'verbose', 'warn', 'error']) {
    console[type] = function () {
      if (clients.browserWindow && (arguments.length === 0 || Array.from(arguments).every(arg => typeof arg === 'string'))) clients.browserWindow.webContents.send('log', type, base64encode(Array.from(arguments).join(' ')))
      else console.fallback('Invalid Arguments', arguments)
    }
  }

  // WebTorrent
  if (!WebTorrent.WEBRTC_SUPPORT) console.error('WebRTC Not Supported')
  clients.webtorrent = new WebTorrent({ maxConns: 250 })
  clients.webtorrent.on('error', console.error)
  clients.webtorrent.on('listening', () => console.info(`Torrent client listening 0.0.0.0:${(clients.webtorrent.address()).port}`))

  // Wallet
  clients.wallet = new Wallet(clients)

  // Transactions
  clients.transactions = new Transactions(clients)
  clients.transactions.loadSavedTransactions()

  if (!fs.existsSync(`ui/${clients.wallet.address}.webp`)) {
    QRCode.toFile(`ui/${clients.wallet.address}.webp`, clients.wallet.address,
      {
        color: {
          dark: '#000',
          light: '#fff'
        },
        width: 200,
        type: 'image/webp'
      },
      (err) => { if (err) throw err }
    )
  }

  const proofs = fs.readdirSync('proofs')
  if (proofs.length > 0) {
    for (const i in proofs) {
      const hash = proofs[i].split('.')[0]
      if (!fs.existsSync(`transactions/${hash}.json`)) {
        clients._ = new Transaction(clients, { torrentPath: `proofs/${proofs[i]}` })
      }
    }
  }

  const userInput = async function (prompt) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise((resolve, reject) => {
      rl.question(`\n============\n${prompt}\n============\n\n`, input => {
        rl.close()
        resolve(input)
      })
    })
  }

  // Mine(clients, clients.wallet.wallet.getPrivateKey(), clients.wallet.address)

  const main = async () => {
    const input = (await userInput('S = Search\nP = Proof\nD = Delete Transactions')).toLowerCase()
    if (input === 's') {
      const query = await userInput('Search')
      console.info(clients.transactions.search(clients, { query }))
    } else if (input === 'p') {
      const query = await userInput('Transaction Hash')
      const torrent = await clients.transactions.search(clients, { query }).transactions.torrent
      console.info('Proof:', torrent.infoHash)
      fs.writeFileSync(`proofs/${query}.torrent`, torrent.torrentFile)
    } else if (input === 'd') {
      console.log('Deleting Dirs')
      clients.webtorrent.destroy()
      fs.rmdirSync('transactions', { recursive: true })
    }
    main()
  }
  main()
})()

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('message-from-renderer', (event, message) => {
  const data = JSON.parse(message)
  if (data.type === 'getTransaction') {
    const transaction = clients.transactions.transactions[data.hash]
    if (transaction) {
      clients.browserWindow.webContents.send(
        'message',
        base64encode(
          JSON.stringify({
            ...transaction.content,
            infohash: transaction.torrent ? transaction.torrent.infoHash : ''
          })
        )
      )
    }
  } else if (data.type === 'transfer') {
    const transaction = new Transaction(clients, {
      from: clients.wallet.address,
      to: data.to,
      amount: data.amount,
      message: data.message
    })
    clients.transactions.addTransaction(transaction)
    console.log('Created Transaction:', transaction.content.hash)
    transaction.announce()
  }
})

setInterval(() => {
  if (clients.browserWindow) {
    clients.browserWindow.webContents.send(
      'message',
      base64encode(
        JSON.stringify({
          address: clients.wallet.address,
          balances: clients.transactions?.balances,
          transactions: JSON.stringify(
            Object.values(clients.transactions.transactions).map(tx => {
              return {
                ...tx.content,
                infohash: tx.torrent?.infoHash ?? ''
              }
            })
          ),
          infohashes: fs.readFileSync('infohashes.txt').toString().split('\n'),
          peers: fs.readFileSync('peers.txt').toString().split('\n'),
          connections: clients.webtorrent.torrents.map(torrent => torrent.numPeers).reduce((a, b) => a + b, 0),
          seeding: clients.webtorrent.torrents.filter(torrent => torrent.done).map(torrent => torrent.infoHash),
          leeching: clients.webtorrent.torrents.filter(torrent => !torrent.done).map(torrent => torrent.infoHash),
          ratio: clients.webtorrent.ratio,
          downloadSpeed: clients.webtorrent.downloadSpeed,
          uploadSpeed: clients.webtorrent.uploadSpeed,
          progress: clients.webtorrent.progress
        })
      )
    )
  }
}, 1000)

/*
TODO:
Instead of staking, users can create "bonds" with other users.
Technically, the protocol allows multiple tx json's in a single torrent file.
A bond is when 2 different addresses back eachother's funds 1:1.
This means, both nodes sign their own transactions to themselves, but they are both put in the same torrent file.
After a bond is made, either party can cancel the bond by re-signing the transaction with an added notice that the bond is cancelled.
The person who initiated the cancellation looses 5%, while the other party makes 5%.
People can form bonds to increase the chances of their funds being stored safely. But bonds are ultra-long term.
Because if you break a bond, you pay the other person 5%.

If a transaction is "lost". Someone can issue a request for the block, and someone else can re-seed the transaction.
The request can have a signed transfer attached, with the previous block marked as a UTXO.
This will mean your money is only valid if you can broadcast the original transaction.
*/
