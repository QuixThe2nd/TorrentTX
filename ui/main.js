import { app, BrowserWindow } from 'electron';
import path from 'path';

const currentDir = path.dirname(new URL(import.meta.url).pathname);

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: `${currentDir}/preload.js`
        }
    });

    win.loadFile('index.html');

    // Start the loop that sends messages to the renderer
    let count = 0;
    setInterval(() => {
        win.webContents.send('message', `Message ${count++}`);
    }, 1000); // Send a message every second
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
