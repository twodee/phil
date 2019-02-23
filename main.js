const { app, Menu, BrowserWindow, ipcMain, dialog } = require('electron');
const { Image, } = require('./twodee');
const minimist = require('minimist');
const fs = require('fs');
const sharp = require('sharp');
// https://sharp.dimens.io

let colorsPath;
let colorHistory = [];
let colorPalette = [];
let argv;

function createMenu() {
	const template = [
		{
			label: 'File',
			submenu: [
        {
          label: 'New',
          accelerator: 'CommandOrControl+N',
          click() {
          },
        },
        {
          label: 'Open',
          accelerator: 'CommandOrControl+O',
          click() {
            dialog.showOpenDialog({
              title: 'Open...',
            }, function(path) {
              loadImage({ path: path, sharp: sharp(path.toString()) });
            });
          },
        },
        {
          role: 'close'
        },
        {
          type: 'separator'
        },
        {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click(item, focusedWindow) {
            focusedWindow.webContents.send('save');
          },
        },
        {
          label: 'Save As...',
          accelerator: 'Shift+CommandOrControl+S',
          click(item, focusedWindow) {
            focusedWindow.webContents.send('saveAs');
          },
        },
        {
          type: 'separator'
        },
        // {
          // role: 'close'
        // },
			]
		},
		{
			label: 'View',
			submenu: [
        // The accelerators for some roles aren't working properly on Linux. I
        // guess I'll "role" my own.
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click(item, focusedWindow) {
            focusedWindow.reload();
          },
        },
        {
          label: 'Force Reload',
          accelerator: 'CommandOrControl+Shift+R',
          click(item, focusedWindow) {
            focusedWindow.webContents.reloadIgnoringCache();
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CommandOrControl+Alt+I',
          click(item, focusedWindow) {
            focusedWindow.toggleDevTools();
          },
        },
				{type: 'separator'},
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click(item, focusedWindow) {
            focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
          },
        },
			]
		},
	];

  if (process.platform === 'darwin') {
    const name = app.getName();
    template.unshift({
      label: name,
      submenu: [
        {
          label: `About ${name}`,
          role: 'about',
        },
        { type: 'separator' },
        { type: 'separator' },
        {
          label: `Hide ${name}`,
          accelerator: 'Command+H',
          role: 'hide',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Alt+H',
          role: 'hideothers',
        },
        {
          label: 'Show All',
          role: 'unhide',
        },
        { type: 'separator' },
        {
          label: `Quit ${name}`,
          accelerator: 'Command+Q',
          click() { app.quit(); },
        },
      ],
    });
  }

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createWindow() {
  let images = [];
  
  if (argv._.length == 2 && Number.isInteger(argv._[0]) && Number.isInteger(argv._[1])) {
    let width = parseInt(argv._[0]);
    let height = parseInt(argv._[1]);
    newWindow(width, height);
  } else if (argv._.length > 0) {
    for (let path of argv._) {
      newWindow(path);
    }
  } else {
    console.error("Usage: npm start -- path");
    console.error("       npm start -- width height");
    process.exit(0);
  }
}

function newWindow() {
  let browser = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: { nodeIntegration: true },
  });
  browser.loadFile('index.html');

  browser.webContents.on('dom-ready', () => {
    if (arguments.length == 1) {
      browser.webContents.send('openImage', arguments[0]);
    } else {
      browser.webContents.send('newImage', arguments[0], arguments[1]);
    }
    browser.webContents.send('update-color-palette', colorPalette);
  });

  browser.on('close', e => {
    e.preventDefault();
    checkDirty(browser);
  });
}

function checkDirty(browser) {
  browser.webContents.executeJavaScript('onPossibleClose()').then(isDirty => {
    if (isDirty) {
      let options = {
        type: 'question',
        defaultId: 0,
        buttons: ['Wait', 'Discard Changes'],
        title: 'Confirm',
        message: 'You have unsaved changes. Discard them?',
      };
      let choice = dialog.showMessageBox(browser, options);
      if (choice == 1) {
        browser.destroy();
      }
    } else {
      browser.destroy();
    }
  });
}

app.on('ready', () => {
  argv = minimist(process.argv.slice(2), {
    default: {
      'background': '255,255,255,1'
    }
  });

  argv.background = argv.background.split(',');
  for (let i = 0; i < 3; ++i) {
    argv.background[i] = parseInt(argv.background[i]);
  }
  if (argv.background.length > 3) {
    argv.background[3] = parseFloat(argv.background[3]);
  }

  createMenu();
  colorsPath = require('os').homedir() + '/.phil.colors.json';

  if (fs.existsSync(colorsPath)) {
    fs.readFile(colorsPath, 'utf8', (error, data) => {
      if (error) {
        console.error(error);
      } else {
        let preferences = JSON.parse(data);
        if (preferences.hasOwnProperty('colorPalette')) {
          colorPalette = preferences.colorPalette;
        }
      }
      createWindow();
    });
  } else {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  let prefs = {
    colorPalette: colorPalette,
  };
  let json = JSON.stringify(prefs, null, 2);
  fs.writeFileSync(colorsPath, json, 'utf8');
});

ipcMain.on('remember-color', (event, color) => {
  let match = colorHistory.find(entry => entry.color[0] == color[0] && entry.color[1] == color[1] && entry.color[2] == color[2] && entry.color[3] == color[3]);

  if (match) {
    match.time = Date.now();
    if (colorHistory.length > 0 && match == colorHistory[colorHistory.length - 1]) {
      return;
    }
    colorHistory.sort((a, b) => {
      if (a.time < b.time) {
        return -1;
      } else if (a.time > b.time) {
        return 1;
      } else {
        return 0;
      }
    });
  } else {
    colorHistory.push({ time: Date.now(), color: color });
  }

  event.sender.send('update-color-history', colorHistory);
});

ipcMain.on('unname-color', (event, name) => {
  for (var i = colorPalette.length - 1; i >= 0; --i) {
    if (colorPalette[i].name == name) {
      colorPalette.splice(i, 1);
    }
  }

  event.sender.send('update-color-palette', colorPalette);
});

ipcMain.on('name-color', (event, name, color) => {
  let isNew = true;

  for (var i = colorPalette.length - 1; i >= 0; --i) {
    if (colorPalette[i].name == name) {
      colorPalette[i].color = color;
      isNew = false;
    }
  }

  if (isNew) {
    colorPalette.push({ name: name, color: color });
  }

  event.sender.send('update-color-palette', colorPalette);
});
