import readline from 'readline';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { video } from './interfaces';
import { v4 as uuid } from 'uuid';

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
puppeteer.use(StealthPlugin());

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

const TIMEOUT = 60000;
const HEIGHT = 1080;
const WIDTH = 1920;

const UPLOAD_URL = 'https://www.youtube.com/upload';

let browser: Browser; 
let page: Page;

let isLoggedIn = false;

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
    })
  });
}

// function that launches a browser
async function launchBrowser(): Promise<void> {
  browser = await puppeteer.launch({ headless: false });
  page = await browser.newPage();
  await page.setDefaultTimeout(TIMEOUT);
  await page.setViewport({ width: WIDTH, height: HEIGHT });
}

async function login(localPage) {
  await localPage.goto(UPLOAD_URL);
  await askQuestion(('Please login and press enter to contine...'));
  isLoggedIn = true;
}

async function upload(videos?: video[]): Promise<string[]> {
  await launchBrowser();

  const youtubeLinks = [];

  if (!isLoggedIn) {
    await login(page);
  }

  for (const video of videos) {
    const link = await uploadVideo(video);
    youtubeLinks.push(link);
  }

  await browser.close();

  return youtubeLinks;
}

async function uploadVideo(video: video) {
  const pathToFile = video.path;

  const { title } = video;
  const { description } = video;
  const { tags } = video;
  const playlistName = video.playlist?.name || `New Playlist ${uuid()}`;
  const videoLang = video.language;

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

  // Wait for upload to complete
  await page.waitForXPath('//*[contains(text(),"Upload complete")]', { timeout: 0 });
  console.log('Uplaod complete, waiting for processing to start');

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

  const playlist = await page.$x('//*[normalize-space(text())=\'Select\']');
  let createplaylistdone;
  if (video.playlist?.create) {
    // Creating new playlist
    // click on playlist dropdown
    await page.evaluate((el) => el.click(), playlist[0]);
    await sleep(2000);

    // click New playlist button
    const newPlaylistXPath = '//*[normalize-space(text())=\'New playlist\']';
    await page.waitForXPath(newPlaylistXPath);
    const createplaylist = await page.$x(newPlaylistXPath);
    await page.evaluate((el) => el.click(), createplaylist[0]);
    await sleep(2000);

    // Enter new playlist name
    await page.keyboard.type(playlistName.substring(0, 148));

    // click create & then done button
    const createplaylistbtn = await page.$x('//*[normalize-space(text())=\'Create\']');
    await page.evaluate((el) => el.click(), createplaylistbtn[1]);
    await sleep(3000);

    createplaylistdone = await page.$x('//*[normalize-space(text())=\'Done\']');
    await page.evaluate((el) => el.click(), createplaylistdone[0]);
  } else if (playlistName) {
    // Selecting playlist
    await page.evaluate((el) => el.click(), playlist[0]);
    const playlistToSelectXPath = `//*[normalize-space(text())='${playlistName}']`;
    await page.waitForXPath(playlistToSelectXPath);
    const playlistNameSelector = await page.$x(playlistToSelectXPath);
    await page.evaluate((el) => el.click(), playlistNameSelector[0]);
    createplaylistdone = await page.$x('//*[normalize-space(text())=\'Done\']');
    await page.evaluate((el) => el.click(), createplaylistdone[0]);
  }

  const moreOption = await page.$x('//*[normalize-space(text())=\'More options\']');
  await moreOption[0].click();

  // Add tags
  if (tags) {
    await page.focus('[placeholder="Add tag"]');
    await page.type('[placeholder="Add tag"]', `${tags.join(', ').substring(0, 495)}, `);
  }

  // Selecting video language
  if (videoLang) {
    const langHandler = await page.$x('//*[normalize-space(text())=\'Video language\']');
    await page.evaluate((el) => el.click(), langHandler[0]);
    // translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
    const langName = await page.$x(`//*[normalize-space(translate(text(),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"))='${videoLang.toLowerCase()}']`);
    await page.evaluate((el) => el.click(), langName[langName.length - 1]);
  }
  // click next button
  const nextBtnXPath = '//*[normalize-space(text())=\'Next\']/parent::*[not(@disabled)]';
  await page.waitForXPath(nextBtnXPath);
  let next = await page.$x(nextBtnXPath);
  await next[0].click();
  await page.waitForXPath(nextBtnXPath);

  // click next button
  next = await page.$x(nextBtnXPath);
  await next[0].click();

  // Get publish button
  const publishXPath = '//*[normalize-space(text())=\'Save\']/parent::*[not(@disabled)]';
  await page.waitForXPath(publishXPath);
  const publish = await page.$x(publishXPath);

  // save youtube upload link
  await page.waitForSelector('[href^="https://youtu.be"]');
  const uploadedLinkHandle = await page.$('[href^="https://youtu.be"]');
  const uploadedLink = await page.evaluate((e) => e.getAttribute('href'), uploadedLinkHandle);

  await publish[0].click();

  try {
    // Wait for closebtn to show up
    await page.waitForXPath(closeBtnXPath, { timeout: 5000 });
  } catch (ex) {
    // Processing finished before completing metadata entry
  }

  return uploadedLink;
}

export { upload };
