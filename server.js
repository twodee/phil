const { app, Menu, BrowserWindow } = require('electron');
const minimist = require('minimist');
const sharp = require('sharp');
// https://sharp.dimens.io

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
            });
          },
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
				{role: 'reload'},
				{role: 'forcereload'},

				// {role: 'toggledevtools'},
				// {role: 'togglefullscreen'}

        // The accelerators for some roles aren't working properly on Linux. I
        // guess I'll "role" my own.
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CommandOrControl+Shift+I',
          click(item, focusedWindow) {
            focusedWindow.toggleDevTools();
          },
        },
				{type: 'separator'},
        {
          label: 'Toggle Fullscreen',
          accelerator: 'Alt+F11',
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
        // {
          // label: 'Services',
          // role: 'services',
          // submenu: [],
        // },
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
  let image;
  let path;
  
  if (argv._.length == 1) {
    path = argv._[0];
    image = sharp(path);
  } else if (argv._.length == 2) {
    path = null;
    let width = parseInt(argv._[0]);
    let height = parseInt(argv._[1]);

    if (!isNaN(width) && !isNaN(height)) {
      image = sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: { r: argv.background[0], g: argv.background[1], b: argv.background[2], alpha: argv.background[3] },
        }
      });
    }
  }

  if (!image) {
    console.error("Usage: npm start -- path");
    console.error("       npm start -- width height");
    process.exit(0);
  }

  image
    .raw()
    .metadata()
    .then(meta => {

      if (meta.channels == 3) {
        image = image.joinChannel(Buffer.alloc(meta.width * meta.height, 255), {
          raw: {
            width: meta.width,
            height: meta.height,
            channels: 1
          }
        })
      }

      image.toBuffer((error, data, info) => {
        var browser = new BrowserWindow({
          width: 800,
          height: 600,
          webPreferences: { nodeIntegration: true },
        });

        browser.loadFile('index.html');
        // browser.webContents.openDevTools({mode: 'bottom'});

        browser.webContents.on('did-finish-load', () => {
          browser.webContents.send('loadImage', path, info.width, info.height, info.channels, data);
        });
      });
    });
}

let argv;
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
  createWindow();
});
