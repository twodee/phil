const { app, BrowserWindow } = require('electron');

function createWindow() {
  var browser = new BrowserWindow({ width: 800, height: 600 });
  browser.loadFile('index.html');
}

app.on('ready', createWindow);
