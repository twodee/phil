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
				{role: 'toggledevtools'},
				{type: 'separator'},
				{role: 'togglefullscreen'}
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
  var browser = new BrowserWindow({ width: 800, height: 600 });
  browser.loadFile('index.html');
  // browser.webContents.openDevTools({mode: 'bottom'});

  browser.webContents.on('did-finish-load', () => {
    let image;
    let path;
    
    // console.log("process.argv:", process.argv);
    if (argv.length == 1) {
      path = process.argv[2];
      image = sharp(path);
    } else {
      path = null;
      image = sharp({
        create: {
          width: parseInt(argv._[0]),
          height: parseInt(argv._[1]),
          channels: 4,
          background: { r: argv.background[0], g: argv.background[1], b: argv.background[2], alpha: argv.background[3] },
        }
      });
    }

    // console.log("image:", image);
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
          console.log("error:", error);
          console.log("data:", data);
          console.log("info:", info);
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

  console.log("argv:", argv);
  createMenu();
  createWindow();
});
