import readline from 'readline';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { EventEmitter } from 'events';
import { Browser, Page } from 'puppeteer';
import { video } from './interfaces';

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
puppeteer.use(StealthPlugin());

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

const TIMEOUT = 60000;
const HEIGHT = 1080;
const WIDTH = 1920;

const UPLOAD_URL = 'https://www.youtube.com/upload';

const eventEmitter = new EventEmitter();

let browser: Browser; 
let page: Page;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface(process.stdin, process.stdout);
    rl.question(question, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}

// function that launches a browser
async function launchBrowser(): Promise<void> {
  browser = await puppeteer.launch({ headless: false });
  page = await browser.newPage();
  await page.setDefaultTimeout(TIMEOUT);
  await page.setViewport({ width: WIDTH, height: HEIGHT });
}

async function login() {
  await page.goto(UPLOAD_URL);
  await askQuestion(('Please login and press enter to continue...'));
}

async function upload(videos?: video[]): Promise<string[]> {
  try {
    await launchBrowser();
    await login();

    const youtubeLinks = [];

    for (const video of videos) {
      eventEmitter.emit('beforeupload', { video });
      const link = await uploadVideo(video);
      eventEmitter.emit('afterupload', { video });
      youtubeLinks.push(link);
    }

    return youtubeLinks;
  } finally {
    await browser.close();
    eventEmitter.removeAllListeners();
  }
}

async function uploadVideo(video: video) {
  const pathToFile = video.path;

  const { title } = video;
  const { description } = video;
  const { tags } = video;

  await page.evaluate(() => { window.onbeforeunload = null; });
  await page.goto(UPLOAD_URL);

  const closeBtnXPath = '//*[normalize-space(text())=\'Close\']';
  const selectBtnXPath = '//*[normalize-space(text())=\'Select files\']';

  for (let i = 0; i < 2; i++) {
    try {
      await page.waitForXPath(selectBtnXPath);
      await page.waitForXPath(closeBtnXPath);
      break;
    } catch (error) {
      const nextText = i === 0 ? ' trying again' : ' failed again';
      console.log('failed to find the select files button for chapter ', nextText);
      console.error(error);
      await page.evaluate(() => { window.onbeforeunload = null; });
      await page.goto(UPLOAD_URL);
    }
  }

  // Remove hidden closebtn text
  const closeBtn = await page.$x(closeBtnXPath);
  await page.evaluate((el) => { el.textContent = 'oldclosse'; }, closeBtn[0]);

  const selectBtn = await page.$x(selectBtnXPath);
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser(),
    selectBtn[0].click(), // button that triggers file selection
  ]);

  await fileChooser.accept([pathToFile]);
  console.log('Started uploading', video.title);

  await page.waitForSelector('.progress-label');

  let loop = true;
  while (loop) {
    try {
      const progress = await page.$eval('.progress-label', (element) => {
        const text = element.innerHTML;
        const matches = text.match(/Uploading (\d+)%/);
        
        if (matches.length > 1) return matches[1];
        return null;
      });

      eventEmitter.emit('uploadprogress', { video, progress });
    } catch (ex) {
      // do nothing, let 'finally' block to handle things
    } finally {
      try {
        // Wait for upload to complete (for 500ms)
        await page.waitForXPath('//*[contains(text(),"Upload complete")]', { timeout: 500 });
        eventEmitter.emit('uploadprogress', { video, progress: 100 });
        console.log('Uplaod complete, waiting for processing to start');
        loop = false;
      } catch (ex) {
        // upload is not complete, do nothing (let the while loop run)
      }
    }
  }

  // Wait for upload to go away and processing to start
  await page.waitForXPath('//*[contains(text(),"Upload complete")]', { hidden: true, timeout: 0 });
  console.log('Processing started');

  // Wait until title & description box pops up
  await page.waitForFunction('document.querySelectorAll(\'[id="textbox"]\').length > 1');
  const textBoxes = await page.$x('//*[@id="textbox"]');

  // Add the title value
  await textBoxes[0].focus();
  await textBoxes[0].type(title.substring(0, MAX_TITLE_LENGTH));

  // Add the Description content
  await textBoxes[1].type(description.substring(0, MAX_DESCRIPTION_LENGTH));

  const childOption = await page.$x('//*[contains(text(),"No, it\'s")]');
  await childOption[0].click();

  if (video.playlist) {
    // click on playlist dropdown
    const playlistDropdown = (await page.$x('//*[normalize-space(text())=\'Select\']'))[0];
    await page.evaluate((el) => el.click(), playlistDropdown);
    await sleep(2000);

    // First, try to select the playlist
    try {
      const playlistToSelectXPath = `//*[normalize-space(text())='${video.playlist}']`;
      await page.waitForXPath(playlistToSelectXPath, { timeout: 5000 });
      const playlistNameSelector = (await page.$x(playlistToSelectXPath))[0];
      await page.evaluate((el) => el.click(), playlistNameSelector);
    } catch (ex) {
      // Failed to select an existing playlist, let's create a new one!
      const newPlaylistXPath = '//*[normalize-space(text())=\'New playlist\' or normalize-space(text())=\'Create playlist\']';
      await page.waitForXPath(newPlaylistXPath);
      const newPlaylistButton = (await page.$x(newPlaylistXPath))[0];
      await page.evaluate((el) => el.click(), newPlaylistButton);
      await sleep(2000);

      // Enter new playlist name
      await page.keyboard.type(video.playlist.substring(0, 148));

      // click create & then done button
      const createPlaylistButton = (await page.$x('//*[normalize-space(text())=\'Create\']'))[1];
      await page.evaluate((el) => el.click(), createPlaylistButton);
      await sleep(3000);
    }

    const createPlaylistDoneButton = (await page.$x('//*[normalize-space(text())=\'Done\']'))[0];
    await page.evaluate((el) => el.click(), createPlaylistDoneButton);
  }

  const moreOption = await page.$x('//*[normalize-space(text())=\'More options\']');
  await moreOption[0].click();

  // Add tags
  if (tags) {
    await page.focus('[placeholder="Add tag"]');
    await page.type('[placeholder="Add tag"]', `${tags.join(', ').substring(0, 495)}, `);
  }

  // click next button
  const nextBtnXPath = '//*[normalize-space(text())=\'Next\']/parent::*[not(@disabled)]';
  await page.waitForXPath(nextBtnXPath);
  let nextButton = (await page.$x(nextBtnXPath))[0];
  await nextButton.click();

  // click next button
  await page.waitForXPath(nextBtnXPath);
  nextButton = (await page.$x(nextBtnXPath))[0];
  await nextButton.click();

  // Get Save button
  const publishXPath = '//*[normalize-space(text())=\'Save\']/parent::*[not(@disabled)]';
  await page.waitForXPath(publishXPath);
  const publish = (await page.$x(publishXPath))[0];

  // save youtube upload link
  await page.waitForSelector('[href^="https://youtu.be"]');
  const uploadedLinkHandle = await page.$('[href^="https://youtu.be"]');
  const uploadedLink = await page.evaluate((e) => e.getAttribute('href'), uploadedLinkHandle);

  await publish.click();

  try {
    // Wait for closebtn to show up
    await page.waitForXPath(closeBtnXPath, { timeout: 5000 });
  } catch (ex) {
    // Processing finished before completing metadata entry
  }

  return uploadedLink;
}

export { upload, eventEmitter };
