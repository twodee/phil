const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');
// https://sharp.dimens.io

function createWindow() {
  var browser = new BrowserWindow({ width: 800, height: 600 });
  browser.loadFile('index.html');

  let path = process.argv[2];
  browser.webContents.on('did-finish-load', () => {
    console.log("loading");
    sharp(path)
      .raw()
      .toBuffer((error, data, info) => {
        console.log("error:", error);
        console.log("data:", data);
        console.log("info:", info);
        browser.webContents.send('loadTexture', info.width, info.height, info.channels, data);
      });
  });
}

app.on('ready', createWindow);
